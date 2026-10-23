import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { openFormsDb } from './forms-db.mjs';
import { createSmtpService, smtpError } from './smtp.mjs';
import { projectFor, validateFields, parse } from './forms-model.mjs';
import { escapeHtml } from './templates.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
// Published Cloudflare proxy ranges, checked against cloudflare.com/ips-v4/ and
// cloudflare.com/ips-v6/ on 2026-10-23. Walk from the nearest trusted proxy.
const cloudflare = new BlockList();
for (const cidr of ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22','2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32']) {
 const [ip,bits] = cidr.split('/'); cloudflare.addSubnet(ip, Number(bits), isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}
export function formClientAddress(req) {
 const normalize = ip => String(ip || '').replace(/^::ffff:/, '');
 const trusted = ip => ['127.0.0.1','::1'].includes(ip) || !!isIP(ip) && cloudflare.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
 let address = normalize(req.socket.remoteAddress);
 if (!trusted(address)) return address;
 for (const value of String(req.headers['x-forwarded-for'] || '').split(',').reverse()) {
  const ip = normalize(value.trim()); if (!isIP(ip)) break;
  address = ip; if (!trusted(ip)) break;
 }
 return address;
}
export function createFormsService(store,options={}){
 const file=path.join(store.dataDir,'forms.sqlite');let db,closed=false,running=null,timer;
 const getDb=()=>{if(closed)throw new Error('Form service is closed.');return db??=(openFormsDb(file));};
 const smtp=createSmtpService(store,getDb,options),rate=new Map();
 const requireProject=id=>projectFor(store.read(),id);
 function limited(key,max,windowMs){const now=Date.now();let value=rate.get(key);if(!value||now>value.until){value={until:now+windowMs,count:0};rate.delete(key);rate.set(key,value);}if(++value.count>max)fail(429,'Too many submissions. Please try again later.');if(rate.size>20000)rate.delete(rate.keys().next().value);}
 function record(row){if(!row)return null;return {id:row.id,formId:row.form_id,formName:row.form_name,createdAt:row.created_at,status:row.status,fields:JSON.parse(row.fields),labels:JSON.parse(row.labels),emailStatus:row.email_status,attempts:row.attempts,lastError:row.last_error};}
 function get(projectId,id){requireProject(projectId);const row=getDb().prepare('SELECT * FROM submissions WHERE project_id=? AND id=?').get(projectId,id);if(!row)fail(404,'Submission not found.');return record(row);}
 function list(projectId,{limit=50,status='',formId='',before=''}={}){requireProject(projectId);limit=Math.max(1,Math.min(100,Number(limit)||50));if(status&&!['new','read','archived'].includes(status))fail(400,'Invalid submission status.');if(formId)parse(z.string().uuid(),formId);let cursor;if(before){parse(z.string().uuid(),before);cursor=getDb().prepare('SELECT created_at,id FROM submissions WHERE project_id=? AND id=?').get(projectId,before);if(!cursor)fail(404,'Submission cursor not found.');}const rows=getDb().prepare('SELECT * FROM submissions WHERE project_id=? AND (?=\'\' OR status=?) AND (?=\'\' OR form_id=?) AND (?=\'\' OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(projectId,status,status,formId,formId,before,cursor?.created_at||'',cursor?.created_at||'',cursor?.id||'',limit+1);const count=getDb().prepare('SELECT count(*) AS total FROM submissions WHERE project_id=?').get(projectId).total;return {submissions:rows.slice(0,limit).map(record),total:count,nextCursor:rows.length>limit?rows[limit-1].id:null};}
 function status(projectId,id,value){parse(z.enum(['new','read','archived']),value);get(projectId,id);getDb().prepare('UPDATE submissions SET status=? WHERE id=? AND project_id=?').run(value,id,projectId);return {submission:get(projectId,id)};}
 function retry(projectId,id){const current=get(projectId,id),p=requireProject(projectId),form=p.forms?.find(f=>f.id===current.formId);if(!form?.notify)fail(400,'Enable notifications for this form before retrying.');if(!smtp.get(projectId).enabled)fail(400,'Enable SMTP before retrying.');if(['sending','pending','sent'].includes(current.emailStatus))fail(409,'This notification is already queued or accepted by SMTP.');getDb().prepare("UPDATE submissions SET email_status='pending',attempts=0,next_attempt_at=0,lease_until=0,last_error='' WHERE project_id=? AND id=?").run(projectId,id);void pump();return {submission:get(projectId,id)};}
 function submit(projectId,formId,body,{client='unknown'}={}){
  const p=requireProject(projectId),form=p.forms?.find(f=>f.id===formId);if(!form?.enabled)fail(404,'This form is not available.');
  if(typeof body?._lumasite_hp==='string'&&body._lumasite_hp.trim())return {success:true,message:form.successMessage};
  const values=validateFields(form,body.fields),key=body.idempotencyKey?parse(z.string().uuid(),body.idempotencyKey):randomUUID(),fingerprint=hash(JSON.stringify(values));
  const existing=getDb().prepare('SELECT id,fingerprint FROM submissions WHERE project_id=? AND form_id=? AND idempotency_key=?').get(projectId,formId,key);
  if(existing){if(existing.fingerprint!==fingerprint)fail(409,'The form data changed. Reload and submit again.');return {success:true,id:existing.id,message:form.successMessage};}
  limited(projectId+':client:'+client,10,3600000);limited(projectId+':form:'+formId,100,3600000);
  const id=randomUUID(),now=new Date().toISOString(),config=smtp.get(projectId),notification=!form.notify?'disabled':config.enabled?'pending':'not_configured';
  getDb().prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,formId,form.name,now,'new',JSON.stringify(values),JSON.stringify(Object.fromEntries(form.fields.map(f=>[f.key,f.label]))),form.replyToField?values[form.replyToField]||'':'',notification,0,0,0,'',`<${id}@${p.domain||'lumasite.invalid'}>`,key,fingerprint);
  void pump();return {success:true,id,message:form.successMessage};
 }
 async function processJob(){const now=Date.now(),database=getDb();database.prepare("UPDATE submissions SET email_status='pending',lease_until=0 WHERE email_status='sending' AND lease_until<?").run(now);
  const row=database.prepare("SELECT * FROM submissions WHERE email_status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 1").get(now);if(!row)return false;
  const p=store.read().projects.find(p=>p.id===row.project_id),form=p?.forms?.find(f=>f.id===row.form_id);
  if(!p||!form?.notify){database.prepare("UPDATE submissions SET email_status='disabled' WHERE id=?").run(row.id);return true;}
  if(!smtp.get(p.id).enabled){database.prepare("UPDATE submissions SET email_status='not_configured' WHERE id=?").run(row.id);return true;}
  database.prepare("UPDATE submissions SET email_status='sending',attempts=attempts+1,lease_until=? WHERE id=?").run(now+120000,row.id);
  const values=JSON.parse(row.fields),labels=JSON.parse(row.labels),display=value=>typeof value==='boolean'?(value?'Yes':'No'):value;
  const lines=Object.entries(values).map(([k,v])=>`${labels[k]||k}: ${display(v)}`),subject=`${p.name.replace(/[\r\n]/g,' ')} — ${row.form_name.replace(/[\r\n]/g,' ')}`.slice(0,200);
  try{await smtp.send(p.id,{subject,text:[`New submission: ${row.form_name}`,`Received: ${row.created_at}`,'',...lines,'',`Submission ID: ${row.id}`].join('\n'),html:`<h2>${escapeHtml(row.form_name)}</h2><p>Received: ${escapeHtml(row.created_at)}</p><table>${Object.entries(values).map(([k,v])=>`<tr><th align="left" style="padding:8px">${escapeHtml(labels[k]||k)}</th><td style="padding:8px;white-space:pre-wrap">${escapeHtml(String(display(v)))}</td></tr>`).join('')}</table><p>Submission ID: ${escapeHtml(row.id)}</p>`,replyTo:row.reply_to,messageId:row.message_id});database.prepare("UPDATE submissions SET email_status='sent',lease_until=0,last_error='' WHERE id=?").run(row.id);}catch(error){const attempts=row.attempts+1,message=smtpError(error);database.prepare('UPDATE submissions SET email_status=?,next_attempt_at=?,lease_until=0,last_error=? WHERE id=?').run(attempts>=5?'failed':'pending',Date.now()+Math.min(3600000,30000*2**(attempts-1)),message,row.id);}return true;
 }
 function pump(){if(closed||running||!db&&!existsSync(file))return running||Promise.resolve();running=(async()=>{for(let i=0;i<5&&!closed;i++)if(!await processJob())break;})().catch(error=>{options.onError?.(error);}).finally(()=>{running=null;});return running;}
 function removeProject(id){if(!db&&!existsSync(file))return;const database=getDb();database.exec('BEGIN IMMEDIATE');try{database.prepare('DELETE FROM submissions WHERE project_id=?').run(id);database.prepare('DELETE FROM smtp_settings WHERE project_id=?').run(id);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}}
 async function close(){if(closed)return;clearInterval(timer);closed=true;await running;db?.close();}
 return {smtp,get,list,status,retry,submit,pump,removeProject,start(){timer=setInterval(()=>void pump(),2000);timer.unref();},close};
}
