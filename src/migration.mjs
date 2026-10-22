import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,open,rename,rm,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {inflateRaw,crc32} from 'node:zlib';
import {promisify} from 'node:util';
import {zip} from 'fflate';
import {z} from 'zod';
import {pageSeoSchema,projectSeoSchema,siteBase} from './seo.mjs';
import {fail,tokenHash,publicProject,getProjectUrls,getPreviewUrl,rememberProjectToken} from './service.mjs';

export const MIGRATION_LIMITS=Object.freeze({archive:100*1024*1024,expanded:250*1024*1024,media:50*1024*1024,json:128*1024*1024,entries:2000});
const inflate=promisify(inflateRaw),digest=v=>createHash('sha256').update(v).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,id=z.string().regex(UUID);
const stamp=z.string().max(40).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/).refine(s=>Number.isFinite(Date.parse(s)));
const extensions=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/gif','gif'],['image/avif','avif'],['video/mp4','mp4'],['video/webm','webm'],['audio/mpeg','mp3'],['audio/wav','wav'],['audio/ogg','ogg'],['audio/mp4','m4a'],['font/woff2','woff2']]);
const slug=z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),domain=z.string().max(253).refine(v=>v===''||/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v));
const name=n=>z.string().min(1).max(n).refine(v=>!!v.trim()),code=n=>z.string().refine(v=>Buffer.byteLength(v)<=n),source=code(1024*1024);
const theme=z.record(z.string(),z.string()).refine(v=>Object.keys(v).length<=128&&Object.entries(v).every(([k,s])=>/^--[a-z][a-z0-9-]{0,60}$/.test(k)&&s.length<=200&&!/[;{}<>]/.test(s)));
const reserved=new Set(['health','runtime','media','release-assets','content-assets','preview-assets','preview','sites','admin','api','mcp']);
const route=z.string().max(300).refine(v=>!v||(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(v)&&!reserved.has(v.split('/')[0])));
const pageSchema=z.object({id,projectId:id,slug:route,title:name(200),description:z.string().max(500),seo:pageSeoSchema.optional(),html:source,css:source,js:source,updatedAt:stamp,revision:z.number().int().min(1).max(2147483647),publishedRevisionId:id.nullable()}).strict();
const revisionSchema=z.object({id,projectId:id,pageId:id,createdAt:stamp,number:z.number().int().min(1).max(2147483647),page:pageSchema,theme,compiledCss:code(8*1024*1024)}).strict();
const assetSchema=z.object({id,projectId:id,name:z.string().max(200),filename:z.string().max(45),mime:z.string().refine(v=>extensions.has(v)),size:z.number().int().min(1).max(MIGRATION_LIMITS.media),createdAt:stamp,url:z.string().max(100)}).strict();
const projectSchema=z.object({id,name:name(100),slug,domain,theme,seo:projectSeoSchema.optional(),createdAt:stamp,updatedAt:stamp}).strict();
const payloadSchema=z.object({schemaVersion:z.literal(1),project:projectSchema,pages:z.array(pageSchema).max(1000),revisions:z.array(revisionSchema).max(5000),assets:z.array(assetSchema).max(MIGRATION_LIMITS.entries-2)}).strict();
const fileSchema=z.object({path:z.string().max(100),size:z.number().int().min(0).max(MIGRATION_LIMITS.json),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const manifestSchema=z.object({format:z.literal('lumasite-project'),version:z.literal(1),createdAt:stamp,projectFile:z.literal('project.json'),files:z.array(fileSchema).min(1).max(MIGRATION_LIMITS.entries-1)}).strict();
const optionsSchema=z.object({name:name(100).optional(),slug:slug.optional(),domain:domain.optional(),linkMode:z.enum(['project','domain']).optional()}).strict();
function parsed(schema,value,label){const r=schema.safeParse(value);if(!r.success)fail(400,`Invalid ${label}: ${r.error.issues[0]?.path.join('.')||'schema'}.`);return r.data;}
function json(bytes,label){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,`Invalid ${label} JSON.`);}}
const pick=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object[key]]));
const pageKeys=['id','projectId','slug','title','description','seo','html','css','js','updatedAt','revision','publishedRevisionId'];
function graph(data){
 const {project,pages,revisions,assets}=data,all=new Set([project.id]),pageIds=new Set(pages.map(p=>p.id)),byRevision=new Map(revisions.map(r=>[r.id,r]));
 const unique=(items,key,label)=>{const seen=new Set();for(const item of items){const v=key(item);if(seen.has(v))fail(400,`Duplicate ${label} in project archive.`);seen.add(v);}};
 unique(pages,p=>p.slug,'draft page path');unique(revisions,r=>`${r.pageId}:${r.number}`,'revision number');
 for(const item of [...pages,...revisions,...assets]){if(all.has(item.id))fail(400,'Duplicate object ID in project archive.');all.add(item.id);if(item.projectId!==project.id)fail(400,'Archive contains an object from another project.');}
 for(const a of assets)if(a.filename!==`${a.id}.${extensions.get(a.mime)}`||a.url!==`/media/${project.id}/${a.filename}`)fail(400,'Invalid project media filename or URL.');
 for(const r of revisions)if(!pageIds.has(r.pageId)||r.page.id!==r.pageId||r.page.projectId!==project.id)fail(400,'Invalid revision page reference.');
 for(const p of [...pages,...revisions.map(r=>r.page)])if(p.publishedRevisionId&&byRevision.get(p.publishedRevisionId)?.pageId!==p.id)fail(400,'Invalid published revision reference.');
 unique(pages.filter(p=>p.publishedRevisionId),p=>byRevision.get(p.publishedRevisionId).page.slug,'published page path');return data;
}
function safeEntry(v){return v==='manifest.json'||v==='project.json'||/^media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp|gif|avif|mp4|webm|mp3|wav|ogg|m4a|woff2)$/i.test(v);}
// Preflight the central AND local records before inflation: object-based unzip
// APIs alone can hide duplicate entries and trust attacker-controlled sizes.
function directory(b){
 if(b.length<22)fail(400,'Invalid or truncated ZIP archive.');let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
 if(end<0)fail(400,'Invalid ZIP end record.');
 const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
 if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count||count===65535||start===0xffffffff||size===0xffffffff)fail(400,'Multipart and ZIP64 archives are not supported.');
 if(count<2||count>MIGRATION_LIMITS.entries)fail(413,'ZIP entry count exceeds the supported bounds.');if(start+size!==end)fail(400,'Invalid ZIP directory bounds.');
 const entries=[],names=new Set();let offset=start,total=0;
 const filename=(at,n)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(at,at+n));}catch{fail(400,'Invalid ZIP filename encoding.');}};
 for(let n=0;n<count;n++){
  if(offset+46>end||b.readUInt32LE(offset)!==0x02014b50)fail(400,'Invalid ZIP directory entry.');
  const flags=b.readUInt16LE(offset+8),method=b.readUInt16LE(offset+10),compressed=b.readUInt32LE(offset+20),expanded=b.readUInt32LE(offset+24),nl=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),attrs=b.readUInt32LE(offset+38),local=b.readUInt32LE(offset+42),crc=b.readUInt32LE(offset+16);
  if(offset+46+nl+extra+comment>end)fail(400,'Truncated ZIP metadata.');const key=filename(offset+46,nl);
  if(!safeEntry(key)||names.has(key))fail(400,'ZIP contains a duplicate, unknown or unsafe entry path.');names.add(key);
  if(flags&~0x0806||![0,8].includes(method)||extra||b.readUInt16LE(offset+34))fail(400,'Encrypted, streaming or unsupported ZIP entries are not accepted.');
  const mode=(attrs>>>16)&0o170000;if((mode&&mode!==0o100000)||(attrs&0x10))fail(400,'ZIP symlinks, directories and special files are not accepted.');
  total+=expanded;if(expanded>(key.endsWith('.json')?MIGRATION_LIMITS.json:MIGRATION_LIMITS.media)||compressed>MIGRATION_LIMITS.archive||total>MIGRATION_LIMITS.expanded)fail(413,'ZIP expanded size exceeds the supported bounds.');
  if(local+30>start||b.readUInt32LE(local)!==0x04034b50)fail(400,'Invalid ZIP local entry.');const lnl=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),dataStart=local+30+lnl+le;
  if(dataStart+compressed>start||le||filename(local+30,lnl)!==key||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method||b.readUInt32LE(local+14)!==crc||b.readUInt32LE(local+18)!==compressed||b.readUInt32LE(local+22)!==expanded)fail(400,'ZIP local and directory metadata do not match.');
  entries.push({name:key,method,compressed,expanded,crc,local,dataStart,end:dataStart+compressed});offset+=46+nl+extra+comment;
 }
 if(offset!==end)fail(400,'Invalid ZIP directory size.');let previous=0;for(const e of [...entries].sort((a,b)=>a.local-b.local)){if(e.local!==previous)fail(400,'Overlapping or unrecognized ZIP local data.');previous=e.end;}if(previous!==start)fail(400,'Unrecognized data before the ZIP directory.');return entries;
}
async function decodeArchive(buffer){
 if(!Buffer.isBuffer(buffer)){if(buffer instanceof Uint8Array)buffer=Buffer.from(buffer);else fail(400,'Upload a project ZIP buffer.');}
 if(buffer.length>MIGRATION_LIMITS.archive)fail(413,'Project ZIP must be at most 100 MiB.');const files=new Map();
 for(const e of directory(buffer)){let bytes;try{const data=buffer.subarray(e.dataStart,e.end);bytes=e.method===0?Buffer.from(data):await inflate(data,{maxOutputLength:Math.max(1,e.expanded)});}catch{fail(400,'Invalid compressed ZIP entry or expanded size.');}if(bytes.length!==e.expanded||(crc32(bytes)>>>0)!==e.crc)fail(400,'ZIP entry size or CRC integrity check failed.');files.set(e.name,bytes);}
 if(!files.has('manifest.json')||!files.has('project.json'))fail(400,'ZIP is missing its LumaSite manifest or project file.');const manifest=parsed(manifestSchema,json(files.get('manifest.json'),'manifest'),'project manifest'),expected=new Set(['manifest.json']);
 for(const item of manifest.files){if(!safeEntry(item.path)||item.path==='manifest.json'||expected.has(item.path))fail(400,'Invalid or duplicate manifest file path.');expected.add(item.path);const bytes=files.get(item.path);if(!bytes||bytes.length!==item.size||digest(bytes)!==item.sha256)fail(400,'Project archive has a missing file or SHA-256 mismatch.');}
 if(expected.size!==files.size||[...files.keys()].some(k=>!expected.has(k)))fail(400,'ZIP contains entries absent from its manifest.');const payload=graph(parsed(payloadSchema,json(files.get('project.json'),'project'),'project schema'));
 if(files.size!==payload.assets.length+2)fail(400,'Project media entries do not match the asset catalog.');for(const a of payload.assets)if(files.get(`media/${a.filename}`)?.length!==a.size)fail(400,'Missing media file or invalid media size.');rejectTokens(files.get('project.json').toString());return{payload,files};
}
function rejectTokens(content){if(/\bls_(?:admin|project)_[A-Za-z0-9_-]{40,}\b/.test(content))fail(400,'Project source contains a live access credential. Remove it before transferring the project.');}
async function readMedia(store,a){const file=await open(path.join(store.dataDir,'media',a.projectId,a.filename),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await file.stat();if(!s.isFile()||s.size!==a.size||s.size>MIGRATION_LIMITS.media)fail(400,'Project media is missing, changed or exceeds the supported size.');return await file.readFile();}finally{await file.close();}}
export async function exportProject(store,projectId){
 const state=store.read(),p=state.projects.find(p=>p.id===projectId);if(!p)fail(404,'Project not found.');
 const payload=graph(parsed(payloadSchema,{schemaVersion:1,project:pick(p,['id','name','slug','domain','theme','seo','createdAt','updatedAt']),pages:state.pages.filter(p=>p.projectId===projectId).map(p=>pick(p,pageKeys)),revisions:state.revisions.filter(r=>r.projectId===projectId).map(r=>({...pick(r,['id','projectId','pageId','createdAt','number','theme','compiledCss']),page:pick(r.page,pageKeys)})),assets:state.assets.filter(a=>a.projectId===projectId).map(a=>pick(a,['id','projectId','name','filename','mime','size','createdAt','url']))},'project data'));
 const content=Buffer.from(JSON.stringify(payload));rejectTokens(content.toString());if(content.length>MIGRATION_LIMITS.json)fail(413,'Project content exceeds the 128 MiB JSON limit.');
 let credentials={};try{credentials=JSON.parse(await readFile(path.join(store.dataDir,'credentials.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const secret of [credentials.adminPassword,credentials.adminToken,...Object.values(credentials.projectTokens||{}),state.instance?.passwordHash,state.instance?.adminTokenHash,p.tokenHash])if(typeof secret==='string'&&secret.length>=12&&content.includes(Buffer.from(secret)))fail(400,'Project source contains an instance credential. Remove it before exporting.');
 const files=new Map([['project.json',content]]);let expanded=content.length;for(const a of payload.assets){expanded+=a.size;if(expanded>MIGRATION_LIMITS.expanded)fail(413,'Project media exceeds the 250 MiB transfer limit.');files.set(`media/${a.filename}`,await readMedia(store,a));}
 files.set('manifest.json',Buffer.from(JSON.stringify({format:'lumasite-project',version:1,createdAt:new Date().toISOString(),projectFile:'project.json',files:[...files].map(([file,bytes])=>({path:file,size:bytes.length,sha256:digest(bytes)}))})));
 const entries=Object.fromEntries([...files].map(([file,bytes])=>[file,[bytes,{level:file.endsWith('.json')?6:0,os:3,attrs:(0o100600*65536)>>>0}]]));
 const buffer=Buffer.from(await new Promise((resolve,reject)=>zip(entries,(e,data)=>e?reject(e):resolve(data))));if(buffer.length>MIGRATION_LIMITS.archive)fail(413,'Project ZIP exceeds the 100 MiB transfer limit.');return{buffer,filename:`${p.slug}-lumasite-project.zip`};
}
const esc=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function rewriter(payload,next,project,ids){
 const prefix=project.linkMode==='domain'?'':`/sites/${project.slug}`,old=payload.project,known=new Set(['',...payload.pages.map(p=>p.slug),...payload.revisions.map(r=>r.page.slug)]),origin='(?:https?:\\/\\/[^\\s"\'`<>/()\\\\]+)?';
 const replacements=new Map(payload.assets.map(a=>[a.url,`/media/${project.id}/${ids.get(a.id)}.${extensions.get(a.mime)}`]));
 for(const r of payload.revisions)for(const ext of ['css','js']){const url=`/release-assets/${ids.get(r.id)}.${ext}`;replacements.set(`/release-assets/${r.id}.${ext}`,url);replacements.set(`/content-assets/${digest(ext==='css'?r.compiledCss:r.page.js)}.${ext}`,url);}
 const previews=new Map(payload.pages.map(p=>{const u=new URL(getPreviewUrl(next,project.id,ids.get(p.id)));return[p.id,{url:u.pathname+u.search,token:u.searchParams.get('token'),revision:p.revision}];}));
 const projectPath=new RegExp(`${origin}/sites/${esc(old.slug)}(?=/|[?#"'\x60\\s<>)]|$)`,'g');
 return value=>{
  for(const[before,after]of replacements)value=value.replace(new RegExp(`${origin}${esc(before)}(?=[?#"'\x60\\s<>)]|$)`,'g'),after);
  for(const[oldId,p]of previews){value=value.replace(new RegExp(`${origin}/preview/${old.id}/${oldId}(?:\\?[^"'\x60\\s<>)]*)?`,'g'),p.url);value=value.replace(new RegExp(`${origin}/preview-assets/${old.id}/${oldId}\\.(css|js)(?:\\?[^"'\x60\\s<>)]*)?`,'g'),(_,ext)=>`/preview-assets/${project.id}/${ids.get(oldId)}.${ext}?token=${p.token}&revision=${p.revision}`);}
  value=value.replace(new RegExp(`${origin}/mcp/${old.id}(?=/|[?#"'\x60\\s<>)]|$)`,'g'),`${next.instance.publicUrl}/mcp/${project.id}`);
  value=value.replaceAll(`/sites/${old.slug}`.replaceAll('/','\\/'),prefix.replaceAll('/','\\/'));
  value=value.replace(projectPath,prefix);
  if(old.domain)value=value.replace(new RegExp(`https?://${esc(old.domain)}(?=/|[?#"'\x60\\s<>)]|$)`,'g'),'');
  value=value.replace(/(["'`])(\/[^"'`\s<>]*)\1/g,(match,quote,url)=>known.has(url.split(/[?#]/)[0].replace(/^\/+|\/+$/g,''))?`${quote}${prefix}/${url.replace(/^\/+/, '')}${quote}`:match);
  return value.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,uuid=>ids.get(uuid)||uuid);
 };
}
export async function importProject(store,buffer,options={}){
 const state=store.read();if(!state.instance)fail(409,'Initialize the destination instance before importing a project.');options=parsed(optionsSchema,options,'import options');const{payload,files}=await decodeArchive(buffer);
 const selectedSlug=options.slug??payload.project.slug,selectedDomain=options.domain??'';if(options.linkMode==='domain'&&!selectedDomain)fail(400,'Domain link mode requires an explicit destination domain.');
 const collision=s=>{if(s.projects.some(p=>p.slug===selectedSlug))fail(409,'That project slug already exists. Choose another slug before importing.');if(selectedDomain&&s.projects.some(p=>p.domain===selectedDomain))fail(409,'That domain already belongs to another project. Choose another domain.');};collision(state);
 const ids=new Map(),taken=new Set([state.instance.id,...state.projects.map(p=>p.id),...state.pages.map(p=>p.id),...state.revisions.map(r=>r.id),...state.assets.map(a=>a.id)]);for(const item of[payload.project,...payload.pages,...payload.revisions,...payload.assets]){let fresh;do{fresh=randomUUID();}while(taken.has(fresh));taken.add(fresh);ids.set(item.id,fresh);}
 const token=`ls_project_${randomBytes(32).toString('base64url')}`,project={...payload.project,id:ids.get(payload.project.id),name:options.name??payload.project.name,slug:selectedSlug,domain:selectedDomain,tokenHash:tokenHash(token)};
 const remapPage=p=>({...p,id:ids.get(p.id),projectId:project.id,publishedRevisionId:p.publishedRevisionId?ids.get(p.publishedRevisionId):null}),pages=payload.pages.map(remapPage),revisions=payload.revisions.map(r=>({...r,id:ids.get(r.id),projectId:project.id,pageId:ids.get(r.pageId),page:remapPage(r.page)})),assets=payload.assets.map(a=>({...a,id:ids.get(a.id),projectId:project.id,filename:`${ids.get(a.id)}.${extensions.get(a.mime)}`,url:`/media/${project.id}/${ids.get(a.id)}.${extensions.get(a.mime)}`}));
 const virtual={...state,projects:[...state.projects,project],pages:[...state.pages,...pages]},rewrite=rewriter(payload,virtual,{...project,linkMode:options.linkMode??'project'},ids);
 for(const p of [...pages,...revisions.map(r=>r.page)])for(const field of['html','css','js'])p[field]=rewrite(p[field]);for(const r of revisions)r.compiledCss=rewrite(r.compiledCss);
 const rewriteSeo=(value,key='')=>{
  if(typeof value==='string'){
   let internal=value.startsWith(`/sites/${payload.project.slug}/`);
   try{const url=new URL(value);internal=!!payload.project.domain&&url.hostname===payload.project.domain||url.pathname.startsWith(`/sites/${payload.project.slug}/`);}catch{}
   if(key==='canonical'&&internal)return '';
   const result=rewrite(value);
   return key!=='canonical'&&internal&&(result===''||result.startsWith('/'))?new URL(result,siteBase(project,state.instance)).href:result;
  }
  if(Array.isArray(value))return value.map(item=>rewriteSeo(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewriteSeo(v,k)]));
  return value;
 };
 if(project.seo)project.seo=rewriteSeo(project.seo);
 for(const p of [...pages,...revisions.map(r=>r.page)])if(p.seo)p.seo=rewriteSeo(p.seo);

 graph(parsed(payloadSchema,{schemaVersion:1,project:publicProject(project),pages,revisions,assets},'remapped project'));
 const stage=path.join(store.dataDir,'.imports',randomUUID()),media=path.join(stage,'media'),target=path.join(store.dataDir,'media',project.id);let attemptedToken=false,moved=false,committed=false;
 try{
  await mkdir(media,{recursive:true,mode:0o700});for(let i=0;i<assets.length;i++){const handle=await open(path.join(media,assets[i].filename),'wx',0o600);try{await handle.writeFile(files.get(`media/${payload.assets[i].filename}`));await handle.sync();}finally{await handle.close();}}
  await store.mutate(async next=>{collision(next);attemptedToken=true;await rememberProjectToken(store,project.id,token);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await rename(media,target);moved=true;next.projects.push(project);next.pages.push(...pages);next.revisions.push(...revisions);next.assets.push(...assets);});committed=true;
  return{project:publicProject(project),token,urls:getProjectUrls(store.read(),project),pages:pages.length,assets:assets.length,revisions:revisions.length};
 }catch(error){if(!committed){if(moved)await rm(target,{recursive:true,force:true});if(attemptedToken)await rememberProjectToken(store,project.id,null);}throw error;}
 finally{await rm(stage,{recursive:true,force:true});}
}
