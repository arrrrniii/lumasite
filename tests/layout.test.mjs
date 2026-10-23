import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, updatePage, createPage, publishPage, restorePage, getPreviewUrl } from '../src/service.mjs';
import { getLayout, updateLayout, publishLayout, restoreLayout, composeLayout } from '../src/layout.mjs';
import { extractLayout } from '../src/layout-extract.mjs';
import { startServers } from '../src/server.mjs';
import { exportProject, importProject } from '../src/migration.mjs';

export async function port() { const s = net.createServer(); await new Promise(r => s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
async function fixture(t) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'lumasite-layout-')),store=await openStore(dataDir);
  const adminPort=await port(),sitePort=await port(),admin=`http://127.0.0.1:${adminPort}`;
  const credentials=await initializeInstance(store,{password:'Layout-test-12345!',port:adminPort,sitePort,publicUrl:admin});
  const {project,token}=await createProject(store,{name:'Layout example',domain:'layout.example.com'});
  const home=store.read().pages[0];
  const html=(body,variant='')=>`<div class="site"><header class="site-header${variant?' '+variant:''}"><a href="/sites/layout-example/">Shared navigation</a></header>\n<dialog id="menu">Menu</dialog><main>${body}</main><footer class="site-footer">Shared footer</footer></div>`;
  await updatePage(store,project.id,home.id,{html:html('Original home','home-header'),css:'.site{color:blue}',js:'window.sharedRuns=(window.sharedRuns||0)+1;'}); await publishPage(store,project.id,home.id);
  const blog=await createPage(store,project.id,{slug:'blog/article',title:'Article',html:html('<header>Article heading</header><h1>Original article</h1>'),css:'.site{color:blue}\n.article{padding:20px}',js:'window.sharedRuns=(window.sharedRuns||0)+1;',seo:{type:'article',author:'Author'}}); await publishPage(store,project.id,blog.id);
  const servers=await startServers({store}); t.after(async()=>{await servers.close();await rm(dataDir,{recursive:true,force:true});});
  const get=(route,host=project.domain)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:sitePort,path:route,headers:{Host:host}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});req.on('error',reject);req.end();});
  const options={sourcePageId:home.id,pageIds:[home.id,blog.id],headerSelector:'header.site-header',footerSelector:'footer.site-footer',additionalHeaderSelector:'#menu',variantClass:'home-header'};
  const migrate=async()=>{const plan=await extractLayout(store,project.id,options);return extractLayout(store,project.id,{...options,dryRun:false,expectedFingerprint:plan.fingerprint});};
  return {store,home,blog,project,token,credentials,admin,get,options,migrate};
}

test('layout extraction is atomic, keeps unpublished content and per-page code, and creates recovery archive',async t=>{
  const f=await fixture(t),before=f.store.read();
  const page=before.pages.find(p=>p.id===f.blog.id);await updatePage(f.store,f.project.id,page.id,{html:page.html.replace('Original article','Unpublished article')});
  const plan=await extractLayout(f.store,f.project.id,f.options);assert.equal(plan.pages,2);assert.equal(f.store.read().projects[0].layout,undefined);
  const result=await extractLayout(f.store,f.project.id,{...f.options,dryRun:false,expectedFingerprint:plan.fingerprint});
  const after=f.store.read(),layout=after.projects[0].layout;
  assert.ok(result.backup.download);assert.equal(after.projectBackups.length,1);assert.equal(layout.history.length,1);
  assert.match(layout.draft.header,/\{\{page.layoutClass\}\}/);assert.match(layout.draft.header,/<dialog/);
  for(const p of after.pages){assert.equal(p.layoutMode,'global');assert.doesNotMatch(p.html,/<header class="site-header|<footer class="site-footer|<dialog/);assert.match(p.html,/<!-- lumasite:header -->/);}
  assert.equal(after.pages[0].css,'');assert.equal(after.pages[0].js,'');
  const blog=after.pages.find(p=>p.id===page.id);assert.match(blog.css,/\.article/);assert.equal(blog.js,'');assert.match(blog.html,/Unpublished article/);
  assert.match((await f.get('/blog/article')).body,/Original article/);assert.doesNotMatch((await f.get('/blog/article')).body,/Unpublished article/);
  const home=(await f.get('/')).body;assert.match(home,/site-header home-header/);assert.equal((home.match(/Shared footer/g)||[]).length,1);assert.match(home,/href="\/"/);
  assert.equal(after.assets.length,before.assets.length);assert.equal(after.projects[0].tokenHash,before.projects[0].tokenHash);
});

test('shared layout drafts remain private; one publish updates existing pages and immutable shared assets; restores are drafts',async t=>{
  const f=await fixture(t);await f.migrate();const before=f.store.read(),first=before.projects[0].layout.published;
  await updateLayout(f.store,f.project.id,{header:'<header>New shared {{page.title}}</header>',css:'.shared-new{color:red}',js:'window.newShared=true;',expectedRevision:1});
  assert.match((await f.get('/')).body,/Shared navigation/);
  const preview=new URL(getPreviewUrl(f.store.read(),f.project.id,f.home.id)),draft=await f.get(preview.pathname+preview.search,'127.0.0.1');assert.match(draft.body,/New shared/);assert.match(draft.headers['x-robots-tag'],/noindex/);
  let source=await f.get(`/preview-assets/${f.project.id}/${f.home.id}.layout.js${preview.search}`,'127.0.0.1');assert.match(source.body,/newShared/);
  assert.equal((await f.get(`/preview-assets/${f.project.id}/${f.home.id}.layout.js`)).status,403);
  assert.equal((await f.get('/layout-assets/missing.js')).status,404);
  await assert.rejects(publishLayout(f.store,f.project.id,{expectedRevision:1}),{status:409});
  await publishLayout(f.store,f.project.id,{expectedRevision:2});
  const current=f.store.read().projects[0].layout.published;
  for(const route of ['/','/blog/article']){const body=(await f.get(route)).body;assert.match(body,/New shared/);assert.match(body,new RegExp(`/layout-assets/${current.id}.css`));assert.equal((body.match(/<footer/g)||[]).length,1);}
  assert.deepEqual(f.store.read().pages,before.pages);assert.deepEqual(f.store.read().revisions,before.revisions);
  assert.match((await f.get(`/layout-assets/${first.id}.js`)).body,/sharedRuns/);assert.match((await f.get(`/layout-assets/${current.id}.js`)).body,/newShared/);
  await restoreLayout(f.store,f.project.id,{snapshotId:first.id,expectedRevision:2});assert.match((await f.get('/')).body,/New shared/);
  await publishLayout(f.store,f.project.id,{expectedRevision:3});assert.match((await f.get('/')).body,/Shared navigation/);
  const future=await createPage(f.store,f.project.id,{slug:'future',title:'Future',html:'<main>Future content</main>'});assert.equal(future.layoutMode,'global');await publishPage(f.store,f.project.id,future.id);assert.match((await f.get('/future')).body,/Shared footer/);
});

test('extraction refuses differing code, invalid selectors and stale plans without modifying content',async t=>{
  const f=await fixture(t),before=f.store.read(),plan=await extractLayout(f.store,f.project.id,f.options);
  await assert.rejects(extractLayout(f.store,f.project.id,{...f.options,dryRun:false}),{status:400});
  await assert.rejects(extractLayout(f.store,f.project.id,{...f.options,headerSelector:'header'}),/exactly one/);
  await updatePage(f.store,f.project.id,f.blog.id,{css:'different'});
  await assert.rejects(extractLayout(f.store,f.project.id,{...f.options,dryRun:false,expectedFingerprint:plan.fingerprint}),{status:409});
  await assert.rejects(extractLayout(f.store,f.project.id,f.options),/Shared CSS/);
  assert.equal(f.store.read().projects[0].layout,undefined);assert.deepEqual(f.store.read().revisions,before.revisions);assert.equal(f.store.read().projectBackups,undefined);
});

test('ZIP create/update remaps shared layouts, slots, media and history while older archives remain supported',async t=>{
  const f=await fixture(t);await f.migrate();
  const first=f.store.read().projects[0].layout.published.id;
  const archive=await exportProject(f.store,f.project.id);
  const copy=await importProject(f.store,archive.buffer,{slug:'layout-copy',domain:'copy.example.com',linkMode:'domain'});
  const project=f.store.read().projects.find(p=>p.id===copy.project.id);assert.notEqual(project.layout.published.id,first);assert.equal(project.layout.published.id,project.layout.history[0].id);assert.doesNotMatch(project.layout.draft.header,/sites\/layout-example/);
  const page=f.store.read().pages.find(p=>p.projectId===project.id&&p.slug==='');assert.equal(page.layoutMode,'global');
  assert.match((await f.get('/',project.domain)).body,/Shared navigation/);assert.equal((await f.get(`/layout-assets/${project.layout.published.id}.css`)).status,200);
  await importProject(f.store,archive.buffer,{mode:'update',projectId:project.id,confirmSlug:'layout-copy'});assert.equal(f.store.read().pages.filter(p=>p.projectId===project.id).length,2);
});

test('layout APIs and MCP are project-scoped and expose all five tools; source never executes in Studio',async t=>{
  const f=await fixture(t);await f.migrate();const endpoint=f.admin+`/api/projects/${f.project.id}/layout`;
  assert.equal((await fetch(endpoint)).status,401);
  const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+f.credentials.adminToken}});assert.equal(response.status,200);assert.equal((await response.json()).pages.length,2);
  const client=new Client({name:'layout-test',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(f.admin+`/mcp/${f.project.id}`),{requestInit:{headers:{Authorization:'Bearer '+f.token}}});await client.connect(transport);t.after(()=>client.close());
  const names=(await client.listTools()).tools.map(t=>t.name);for(const name of ['layout_get','layout_update','layout_publish','layout_restore','layout_extract'])assert.ok(names.includes(name));
  const result=await client.callTool({name:'layout_update',arguments:{footer:'<footer>MCP footer</footer>',expectedRevision:1}});assert.equal(result.isError,undefined);assert.match((await f.get('/')).body,/Shared footer/);
  await client.callTool({name:'layout_publish',arguments:{expectedRevision:2}});assert.match((await f.get('/')).body,/MCP footer/);
  await assert.rejects(updateLayout(f.store,f.project.id,{js:'ls_project_'+'x'.repeat(45)}),{status:400});
});

test('slots escape page bindings, reject duplicate slots and standalone pages keep their own shell',()=>{
  const content={header:'<header>{{page.title}} {{page.layoutClass}}</header>',footer:'<footer>End</footer>'};
  assert.equal(composeLayout('Body',{layoutMode:'none'},content),'Body');
  assert.match(composeLayout('<!-- lumasite:header --><main>Body</main><!-- lumasite:footer -->',{layoutMode:'global',title:'<script>',layoutClass:'home-header'},content),/&lt;script&gt; home-header/);
  assert.throws(()=>composeLayout('<!-- lumasite:header --><!-- lumasite:header -->',{layoutMode:'global'},content),{status:400});
});

test('extraction preserves CSS inserted between common sections, and published layout is idempotent',async t=>{
 const f=await fixture(t),state=f.store.read(),home=state.pages.find(p=>p.id===f.home.id),blog=state.pages.find(p=>p.id===f.blog.id);
 const css='.shared{color:blue}\n/* common final overrides */\nheader{position:fixed}';
 await updatePage(f.store,f.project.id,home.id,{css});await publishPage(f.store,f.project.id,home.id);
 await updatePage(f.store,f.project.id,blog.id,{css:css.replace('/* common final overrides */','.article{font-size:20px}\n/* common final overrides */')});await publishPage(f.store,f.project.id,blog.id);
 await f.migrate();const after=f.store.read(),layout=after.projects[0].layout;
 assert.match(layout.published.cssAfter,/header\{position:fixed\}/);
 const nextBlog=after.pages.find(p=>p.id===blog.id);assert.equal(layout.draft.css+nextBlog.css+layout.draft.cssAfter,css.replace('/* common final overrides */','.article{font-size:20px}\n/* common final overrides */'));
 const html=(await f.get('/blog/article')).body;assert.ok(html.indexOf(`/layout-assets/${layout.published.id}.css`)<html.indexOf('/content-assets/'));assert.ok(html.indexOf('.after.css')>html.indexOf('/content-assets/'));
 assert.equal((await f.get(`/layout-assets/${layout.published.id}.after.css`)).body,layout.published.cssAfter);
 await publishLayout(f.store,f.project.id,{expectedRevision:1});assert.equal(f.store.read().projects[0].layout.history.length,1);
 const preview=new URL(getPreviewUrl(f.store.read(),f.project.id,f.blog.id));const final=await f.get(`/preview-assets/${f.project.id}/${f.blog.id}.layout-after.css${preview.search}`,'127.0.0.1');assert.equal(final.body,layout.draft.cssAfter);
});


test('extraction preserves module scope by refusing partial JavaScript extraction',async t=>{
 const f=await fixture(t),blog=f.store.read().pages.find(p=>p.id===f.blog.id);
 const javascript=blog.js+'\nconst localArticle = document.querySelector("main");';
 await updatePage(f.store,f.project.id,blog.id,{js:javascript});await publishPage(f.store,f.project.id,blog.id);
 await assert.rejects(extractLayout(f.store,f.project.id,f.options),/match exactly/);
 const options={...f.options,shareJs:false},plan=await extractLayout(f.store,f.project.id,options);
 await extractLayout(f.store,f.project.id,{...options,dryRun:false,expectedFingerprint:plan.fingerprint});
 assert.equal(f.store.read().projects[0].layout.published.js,'');assert.equal(f.store.read().pages.find(p=>p.id===blog.id).js,javascript);
});
