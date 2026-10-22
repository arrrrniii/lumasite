import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,rename,mkdir,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject,createPage,updatePage,publishPage,uploadAsset,updateProject,getPreviewUrl,tokenMatches,verifyPreviewToken} from '../src/service.mjs';
import {exportProject,importProject,MIGRATION_LIMITS} from '../src/migration.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=','base64');
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'lumasite-project-zip-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const instance=async name=>{const store=await openStore(path.join(directory,name));const credentials=await initializeInstance(store,{password:`${name}-Example-Password-123!`,port:4300,sitePort:4301,publicUrl:`https://${name}-admin.example.test`,sitePublicUrl:`https://${name}-sites.example.test`});return{store,credentials};};
  const source=await instance('source'),target=await instance('target');
  const created=await createProject(source.store,{name:'Portable Source',slug:'original-site',domain:'old.example.test'});
  const project=created.project,home=source.store.read().pages[0];
  await updateProject(source.store,project.id,{theme:{'--site-accent':'#4f8cff'}});
  const asset=await uploadAsset(source.store,project.id,{name:'cover.png',mime:'image/png',data:png});
  await updatePage(source.store,project.id,home.id,{html:`<h1>First public snapshot</h1><img src="${asset.url}">`,css:`.cover{background-image:url('${asset.url}')}`,js:`window.cover='${asset.url}';`});
  const first=await publishPage(source.store,project.id,home.id);
  const oldRevision=source.store.read().revisions.find(r=>r.id===first.revision.id);
  const cssHash=sha(oldRevision.compiledCss),jsHash=sha(oldRevision.page.js),preview=getPreviewUrl(source.store.read(),project.id,home.id);
  const html=`<main><h1>Second public snapshot</h1><a href="/sites/${project.slug}/about">Project about</a><a href="https://source-sites.example.test/sites/${project.slug}/about?from=hero#details">Absolute project link</a><a href="https://${project.domain}/about">Domain about</a><a href="/about">Clean about</a><img src="https://source-sites.example.test${asset.url}?v=1"><link href="/release-assets/${oldRevision.id}.css"><link href="/content-assets/${cssHash}.css"><script src="/content-assets/${jsHash}.js"></script><a href="${preview}">Preview</a><script src="/preview-assets/${project.id}/${home.id}.js?token=obsolete"></script><a href="https://source-admin.example.test/mcp/${project.id}">MCP</a></main>`;
  const js=`window.media='${asset.url}';window.project='${project.id}';window.route='/sites/${project.slug}/about';window.preview='${preview}';`;
  await updatePage(source.store,project.id,home.id,{html,css:`.cover{background:url('${asset.url}')} .cache{background:url('/release-assets/${oldRevision.id}.css')}`,js});
  const second=await publishPage(source.store,project.id,home.id);
  await updatePage(source.store,project.id,home.id,{html:html.replace('Second public snapshot','Private newer draft')});
  await createPage(source.store,project.id,{title:'About',slug:'about',html:'<h1>Private about draft</h1><a href="/">Home</a>'});
  const other=await createProject(source.store,{name:'Other source project',slug:'excluded-project'});
  await uploadAsset(source.store,other.project.id,{name:'other.png',mime:'image/png',data:png});
  await writeFile(path.join(source.store.dataDir,'unrelated-private-source.txt'),'not project media');
  const existing=await createProject(target.store,{name:'Existing destination',slug:'existing-site'});
  const exported=await exportProject(source.store,project.id);
  return{directory,source,target,project,sourceToken:created.token,home,asset,first,second,existing,exported};
}
async function snapshot(store){return{state:await readFile(path.join(store.dataDir,'state.json')),credentials:await readFile(path.join(store.dataDir,'credentials.json')),memory:store.read(),media:await readdir(path.join(store.dataDir,'media')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))};}
async function unchanged(store,before){const after=await snapshot(store);assert.deepEqual(after,before);const stages=await readdir(path.join(store.dataDir,'.imports')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));assert.deepEqual(stages,[]);}
function unpack(buffer){return Object.fromEntries(Object.entries(unzipSync(buffer)).map(([name,bytes])=>[name,Buffer.from(bytes)]));}
function repack(files,{manifest=true}={}){if(manifest){const old=JSON.parse(files['manifest.json']);old.files=Object.entries(files).filter(([key])=>key!=='manifest.json').map(([key,bytes])=>({path:key,size:bytes.length,sha256:sha(bytes)}));files['manifest.json']=Buffer.from(JSON.stringify(old));}return Buffer.from(zipSync(files));}
function changedPayload(buffer,change){const files=unpack(buffer),payload=JSON.parse(files['project.json']);change(payload);files['project.json']=Buffer.from(JSON.stringify(payload));return repack(files);}
function records(buffer){const end=buffer.length-22;let pos=buffer.readUInt32LE(end+16);const found=[];while(pos<end){const local=buffer.readUInt32LE(pos+42),length=buffer.readUInt16LE(pos+28);found.push({central:pos,local,name:buffer.subarray(pos+46,pos+46+length).toString(),length});pos+=46+length+buffer.readUInt16LE(pos+30)+buffer.readUInt16LE(pos+32);}return found;}

test('a real project ZIP preserves drafts, selected publication, complete history and only project media',async t=>{
  const f=await fixture(t),sourceBefore=await snapshot(f.source.store),targetBefore=f.target.store.read();
  assert.equal(f.exported.buffer.subarray(0,4).toString('hex'),'504b0304');assert.equal(f.exported.filename,'original-site-lumasite-project.zip');
  const files=unpack(f.exported.buffer),manifest=JSON.parse(files['manifest.json']),payload=JSON.parse(files['project.json']);
  assert.deepEqual(Object.keys(files).sort(),['manifest.json',`media/${f.asset.filename}`,'project.json'].sort());
  assert.equal(manifest.format,'lumasite-project');assert.equal(manifest.version,1);
  for(const file of manifest.files){assert.equal(sha(files[file.path]),file.sha256);assert.equal(files[file.path].length,file.size);}
  assert.equal(payload.project.tokenHash,undefined);assert.equal(payload.instance,undefined);assert.equal(payload.pages.length,2);assert.equal(payload.revisions.length,2);
  for(const secret of [f.source.credentials.password,f.source.credentials.adminToken,f.sourceToken,f.source.store.read().instance.passwordHash,f.source.store.read().instance.adminTokenHash])assert.equal(files['project.json'].includes(Buffer.from(secret)),false);
  const imported=await importProject(f.target.store,f.exported.buffer,{name:'Imported website',slug:'fresh-site'});
  assert.equal(imported.project.name,'Imported website');assert.equal(imported.project.domain,'');assert.equal(imported.project.tokenHash,undefined);assert.equal(imported.pages,2);assert.equal(imported.assets,1);assert.equal(imported.revisions,2);assert.notEqual(imported.token,f.sourceToken);
  const state=f.target.store.read(),project=state.projects.find(p=>p.id===imported.project.id),pages=state.pages.filter(p=>p.projectId===project.id),revisions=state.revisions.filter(r=>r.projectId===project.id),asset=state.assets.find(a=>a.projectId===project.id),home=pages.find(p=>p.slug===''),about=pages.find(p=>p.slug==='about');
  assert.deepEqual(state.projects.filter(p=>p.id!==project.id),targetBefore.projects);assert.deepEqual(state.pages.filter(p=>p.projectId!==project.id),targetBefore.pages);assert.equal(tokenMatches(imported.token,project.tokenHash),true);
  for(const old of [f.project.id,...payload.pages.map(p=>p.id),...payload.revisions.map(r=>r.id),f.asset.id])assert.equal(JSON.stringify({project,pages,revisions,asset}).includes(old),false,`Source ID ${old} was remapped`);
  assert.match(home.html,/Private newer draft/);assert.equal(home.revision,payload.pages.find(p=>p.id===f.home.id).revision);assert.equal(about.publishedRevisionId,null);
  const live=revisions.find(r=>r.id===home.publishedRevisionId);assert.equal(live.number,2);assert.match(live.page.html,/Second public snapshot/);assert.doesNotMatch(live.page.html,/Private newer draft/);assert.equal(live.page.publishedRevisionId,revisions.find(r=>r.number===1).id);assert.deepEqual(project.theme,{'--site-accent':'#4f8cff'});
  for(const value of [home.html,home.js,live.page.html]){assert.match(value,/\/sites\/fresh-site\/about/);assert.equal(value.includes('/sites/original-site'),false);assert.equal(value.includes('source-sites.example.test'),false);assert.equal(value.includes('old.example.test'),false);}
  assert.match(home.html,new RegExp(`href="/sites/fresh-site/about\\?from=hero#details"`));assert.match(home.html,new RegExp(`/release-assets/${revisions.find(r=>r.number===1).id}\\.css`));assert.match(home.html,new RegExp(`https://target-admin.example.test/mcp/${project.id}`));
  for(const value of [home.html,home.css,home.js,...revisions.map(r=>r.compiledCss)])assert.equal(value.includes(f.asset.url),false);
  assert.ok(home.css.includes(asset.url));assert.ok(live.compiledCss.includes(asset.url));assert.deepEqual(await readFile(path.join(f.target.store.dataDir,'media',project.id,asset.filename)),png);
  const previewMatch=home.html.match(/href="(\/preview\/[^\"]+)"/),previewUrl=new URL(previewMatch[1],'https://target-sites.example.test');assert.equal(verifyPreviewToken(state,previewUrl.searchParams.get('token'),project.id,home.id),true);
  const credentials=JSON.parse(await readFile(path.join(f.target.store.dataDir,'credentials.json')));assert.equal(credentials.projectTokens[project.id],imported.token);assert.equal(credentials.projectTokens[f.existing.project.id],f.existing.token);assert.equal(credentials.adminToken,f.target.credentials.adminToken);assert.equal((await stat(path.join(f.target.store.dataDir,'credentials.json'))).mode&0o077,0);assert.equal((await stat(path.join(f.target.store.dataDir,'media',project.id,asset.filename))).mode&0o077,0);
  assert.equal(imported.urls.mcp,`https://target-admin.example.test/mcp/${project.id}`);assert.equal(imported.urls.site,'https://target-sites.example.test/sites/fresh-site/');assert.equal(imported.urls.production,null);
  await unchanged(f.source.store,sourceBefore);
});

test('domain link mode is explicit and produces clean internal links with remapped media',async t=>{
  const f=await fixture(t),before=await snapshot(f.target.store);
  await assert.rejects(importProject(f.target.store,f.exported.buffer,{linkMode:'domain'}),e=>e.status===400&&/requires.*domain/i.test(e.message));await unchanged(f.target.store,before);
  const imported=await importProject(f.target.store,f.exported.buffer,{slug:'domain-site',domain:'www.new.example.test',linkMode:'domain'}),state=f.target.store.read(),home=state.pages.find(p=>p.projectId===imported.project.id&&p.slug===''),about=state.pages.find(p=>p.projectId===imported.project.id&&p.slug==='about');
  assert.equal(imported.urls.production,'https://www.new.example.test/');assert.match(home.html,/href="\/about"/);assert.match(home.html,/href="\/about\?from=hero#details"/);assert.equal(home.html.includes('/sites/'),false);assert.equal(home.js.includes('/sites/'),false);assert.match(about.html,/href="\/"/);assert.match(home.html,new RegExp(`/media/${imported.project.id}/`));
});

test('collisions and invalid options never modify destination state, credentials or media',async t=>{
  const f=await fixture(t),before=await snapshot(f.target.store);
  for(const options of [{slug:'existing-site'},{domain:'has/path'},{slug:'../unsafe'},{name:''},{linkMode:'unexpected'},{unexpected:true}]){await assert.rejects(importProject(f.target.store,f.exported.buffer,options),e=>[400,409].includes(e.status));await unchanged(f.target.store,before);}
  await importProject(f.target.store,f.exported.buffer,{slug:'first-copy',domain:'same.example.test'});const committed=await snapshot(f.target.store);
  await assert.rejects(importProject(f.target.store,f.exported.buffer,{slug:'different-copy',domain:'same.example.test'}),e=>e.status===409);await unchanged(f.target.store,committed);
});

test('malformed schemas, missing media, digest failures and source credentials are rejected before staging',async t=>{
  const f=await fixture(t),before=await snapshot(f.target.store),bad=[];
  bad.push(f.exported.buffer.subarray(0,50),Buffer.from('not a zip'));
  const digest=unpack(f.exported.buffer);digest[`media/${f.asset.filename}`][0]^=255;bad.push(repack(digest,{manifest:false}));
  const missing=unpack(f.exported.buffer);delete missing[`media/${f.asset.filename}`];bad.push(repack(missing));
  bad.push(changedPayload(f.exported.buffer,p=>p.schemaVersion=99),changedPayload(f.exported.buffer,p=>p.project.tokenHash='forbidden'),changedPayload(f.exported.buffer,p=>p.pages[0].id='../escape'),changedPayload(f.exported.buffer,p=>p.revisions[0].pageId=randomUUID()),changedPayload(f.exported.buffer,p=>p.pages[0].publishedRevisionId=randomUUID()),changedPayload(f.exported.buffer,p=>p.assets[0].filename='../../escape.png'),changedPayload(f.exported.buffer,p=>p.pages[0].html=f.sourceToken));
  for(const archive of bad){await assert.rejects(importProject(f.target.store,archive),e=>e.status===400);await unchanged(f.target.store,before);}
  const page=f.source.store.read().pages.find(p=>p.id===f.home.id);await updatePage(f.source.store,f.project.id,page.id,{html:`<p>${f.source.credentials.password}</p>`});await assert.rejects(exportProject(f.source.store,f.project.id),e=>e.status===400&&/credential/i.test(e.message));
});

test('ZIP paths, duplicate records, symlinks, encryption, metadata mismatches and expansion bounds are enforced',async t=>{
  const f=await fixture(t),before=await snapshot(f.target.store),bad=[];
  for(const filename of ['../outside.txt','/absolute.txt','unknown.txt','media/../../outside.png']){const files=unpack(f.exported.buffer);files[filename]=Buffer.from('unsafe');bad.push([repack(files),400]);}
  const encrypted=Buffer.from(f.exported.buffer),enc=records(encrypted)[0];encrypted.writeUInt16LE(1,enc.central+8);encrypted.writeUInt16LE(1,enc.local+6);bad.push([encrypted,400]);
  const symlink=Buffer.from(f.exported.buffer),sym=records(symlink)[0];symlink.writeUInt32LE((0o120777*65536)>>>0,sym.central+38);bad.push([symlink,400]);
  const mismatched=Buffer.from(f.exported.buffer),mis=records(mismatched)[0];mismatched.writeUInt32LE(123,mis.local+14);bad.push([mismatched,400]);
  const bounded=Buffer.from(f.exported.buffer),bound=records(bounded).find(r=>r.name==='project.json');bounded.writeUInt32LE(MIGRATION_LIMITS.json+1,bound.central+24);bounded.writeUInt32LE(MIGRATION_LIMITS.json+1,bound.local+22);bad.push([bounded,413]);
  const lying=Buffer.from(f.exported.buffer),lie=records(lying).find(r=>r.name==='project.json');lying.writeUInt32LE(2,lie.central+24);lying.writeUInt32LE(2,lie.local+22);bad.push([lying,400]);
  const duplicates=unpack(f.exported.buffer),duplicateName=`media/${randomUUID()}.png`;duplicates[duplicateName]=png;const duplicate=repack(duplicates),rec=records(duplicate),first=rec.find(r=>r.name===`media/${f.asset.filename}`),last=rec.find(r=>r.name===duplicateName);duplicate.write(first.name,last.central+46,last.length);duplicate.write(first.name,last.local+30,last.length);bad.push([duplicate,400]);
  for(const[archive,status]of bad){await assert.rejects(importProject(f.target.store,archive),e=>e.status===status);await unchanged(f.target.store,before);}
});

test('a failed final state write rolls back staged media and the new bearer without changing existing projects',async t=>{
  const f=await fixture(t),before=await snapshot(f.target.store),stateFile=path.join(f.target.store.dataDir,'state.json'),backup=path.join(f.target.store.dataDir,'state.json.saved');
  await rename(stateFile,backup);await mkdir(stateFile);
  try{await assert.rejects(importProject(f.target.store,f.exported.buffer),e=>['EISDIR','ENOTDIR','EEXIST'].includes(e.code));assert.deepEqual(f.target.store.read(),before.memory);assert.deepEqual(await readFile(path.join(f.target.store.dataDir,'credentials.json')),before.credentials);assert.deepEqual(await readdir(path.join(f.target.store.dataDir,'media')),before.media);assert.deepEqual(await readdir(path.join(f.target.store.dataDir,'.imports')),[]);}
  finally{await rm(stateFile,{recursive:true});await rename(backup,stateFile);}
  await unchanged(f.target.store,before);
});

test('simultaneous imports of the same slug commit exactly one complete project',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([importProject(f.target.store,f.exported.buffer),importProject(f.target.store,f.exported.buffer)]),success=results.filter(r=>r.status==='fulfilled'),failures=results.filter(r=>r.status==='rejected');
  assert.equal(success.length,1);assert.equal(failures.length,1);assert.equal(failures[0].reason.status,409);const state=f.target.store.read();assert.equal(state.projects.length,2);assert.equal(state.assets.length,1);const credentials=JSON.parse(await readFile(path.join(f.target.store.dataDir,'credentials.json')));assert.deepEqual(Object.keys(credentials.projectTokens).sort(),state.projects.map(p=>p.id).sort());assert.deepEqual(await readdir(path.join(f.target.store.dataDir,'media')),[success[0].value.project.id]);assert.deepEqual(await readdir(path.join(f.target.store.dataDir,'.imports')),[]);
});

test('project JSON larger than the old 30 MiB cap transfers without recompiling history',async t=>{
  const f=await fixture(t);
  await f.source.store.mutate(state=>{const first=state.revisions.find(r=>r.projectId===f.project.id);for(let i=0;i<5;i++)state.revisions.push({...structuredClone(first),id:randomUUID(),number:i+3,compiledCss:('/* retained CSS snapshot */\n').repeat(260000)});});
  const archive=await exportProject(f.source.store,f.project.id),projectBytes=unpack(archive.buffer)['project.json'];assert.ok(projectBytes.length>30*1024*1024);assert.equal(MIGRATION_LIMITS.json,128*1024*1024);const imported=await importProject(f.target.store,archive.buffer);assert.equal(imported.revisions,7);const oldCss=f.source.store.read().revisions.find(r=>r.number===7).compiledCss,newCss=f.target.store.read().revisions.find(r=>r.projectId===imported.project.id&&r.number===7).compiledCss;assert.equal(newCss,oldCss);
});
