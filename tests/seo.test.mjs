import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {request as httpRequest} from 'node:http';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject,createPage,updatePage,updateProject,publishPage,restorePage,renderDocument,uploadAsset,getPreviewUrl} from '../src/service.mjs';
import {renderSeo,validateSeo,jsonScript,indexablePages,feedXml,renderBlogList} from '../src/seo.mjs';
import {startServers} from '../src/server.mjs';
import {exportProject,importProject} from '../src/migration.mjs';

async function ports(){
 const servers=await Promise.all([0,1].map(()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>resolve(server));})));
 const result=servers.map(server=>server.address().port);await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));return result;
}
async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lumasite-seo-')),[port,sitePort]=await ports(),store=await openStore(dataDir);
 const credentials=await initializeInstance(store,{password:'SEO-Tests-Password-123!',port,sitePort,publicUrl:`http://127.0.0.1:${port}`,sitePublicUrl:`http://127.0.0.1:${sitePort}`});
 const {project}=await createProject(store,{name:'SEO & blog',domain:'seo.example.com'});
 const servers=await startServers({dataDir,store});
 t.after(async()=>{await servers.close();await rm(dataDir,{recursive:true,force:true});});
 const get=(route,host='seo.example.com')=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:sitePort,path:route,headers:{Host:host}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();
 });
 return{store,project,get,credentials,port,sitePort};
}
const graph=html=>JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const tinyPNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=','base64');

test('SEO validation, safe JSON-LD and canonical rendering protect the document head',()=>{
 for(const seo of [{canonical:'javascript:alert(1)'},{image:'//evil.example/image.png'},{image:'data:image/svg+xml,test'},{publishedTime:'yesterday'},{noindex:'false'},{structuredData:'<script>'}])assert.throws(()=>validateSeo(seo),{status:400});
 assert.throws(()=>validateSeo({language:'en-@'},true),{status:400});
 const payload={'@type':'Thing',name:'</script><script>window.bad=true</script>\u2028&'};
 assert.equal(jsonScript(payload).includes('</script>'),false);assert.deepEqual(JSON.parse(jsonScript(payload)),payload);
 const project={name:'Test & Co',slug:'test',domain:'site.example.com',seo:{language:'sq-AL',image:'/media/a.png',logo:'/media/logo.png',favicon:'/media/icon.png'}};
 const page={id:'page',projectId:'project',title:'Title <script>',description:'A "description" & details',slug:'blog/hello',revision:1,updatedAt:'2026-10-22T12:00:00.000Z',html:'<main><h1>Actual heading</h1></main>',css:'',js:'',seo:{type:'article',headline:'Hello',author:'Test team',publishedTime:'2026-10-22T11:00:00.000Z',structuredData:payload}};
 const html=renderDocument(page,{project});assert.match(html,/<html lang="sq-AL" dir="ltr">/);assert.match(html,/href="https:\/\/site.example.com\/blog\/hello"/);assert.match(html,/property="og:image" content="https:\/\/site.example.com\/media\/a.png"/);assert.match(html,/href="\/media\/icon.png"/);assert.match(html,/Title &lt;script&gt;/);assert.equal(html.includes('<script>window.bad'),false);
 const nodes=graph(html);assert.ok(nodes.some(n=>n['@type']==='BlogPosting'&&n.headline==='Hello'));assert.ok(nodes.some(n=>n['@type']==='BreadcrumbList'&&n.itemListElement.length===3));
 assert.match(renderSeo(page,{project,preview:true}).head,/noindex,nofollow/);
});

test('production SEO resources use published revisions, isolate tenants and protect previews',async t=>{
 const f=await fixture(t),{store,project}=f;
 const home=store.read().pages.find(p=>p.projectId===project.id);await publishPage(store,project.id,home.id);
 const blog=await createPage(store,project.id,{title:'The blog',slug:'blog',html:'<main><h1>The blog</h1><!-- lumasite:blog-list --></main>'});await publishPage(store,project.id,blog.id);
 const post=await createPage(store,project.id,{title:'Published <story>',slug:'blog/hello',description:'A useful guide',html:'<main><h1>Hello</h1><!-- lumasite:blog-related --></main>',seo:{type:'article',headline:'Hello <reader>',publishedTime:'2026-10-22T12:00:00.000Z',canonical:'https://seo.example.com/blog/hello'}});const first=await publishPage(store,project.id,post.id);
 const hidden=await createPage(store,project.id,{title:'Hidden sample',slug:'sample',html:'<h1>Sample</h1>',seo:{type:'article',noindex:true}});await publishPage(store,project.id,hidden.id);
 const duplicate=await createPage(store,project.id,{title:'Duplicate',slug:'duplicate',seo:{canonical:'https://elsewhere.example/original'}});await publishPage(store,project.id,duplicate.id);
 await createPage(store,project.id,{title:'Secret draft',slug:'secret-draft',html:'<h1>Do not expose</h1>',seo:{type:'article'}});
 const other=await createProject(store,{name:'Other',domain:'other.example.com'});const otherPage=store.read().pages.find(p=>p.projectId===other.project.id);await publishPage(store,other.project.id,otherPage.id);
 let response=await f.get('/blog/hello');assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);assert.match(await response.text(),/index,follow,max-image-preview:large/);
 response=await f.get(`/sites/${project.slug}/blog/hello`,'preview.example.com');assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.match(await response.text(),/https:\/\/seo.example.com\/blog\/hello/);
 const preview=new URL(getPreviewUrl(store.read(),project.id,post.id));response=await f.get(preview.pathname+preview.search,'127.0.0.1');assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.match(await response.text(),/noindex,nofollow/);
 const adminRobots=await fetch(`http://127.0.0.1:${f.port}/robots.txt`);assert.match(await adminRobots.text(),/Disallow: \//);assert.match(adminRobots.headers.get('x-robots-tag'),/noindex/);
 const sitemap=await(await f.get('/sitemap.xml')).text();assert.match(sitemap,/https:\/\/seo.example.com\/blog\/hello/);assert.match(sitemap,/<lastmod>/);assert.doesNotMatch(sitemap,/secret-draft|sample|duplicate|other.example.com/);
 assert.match(sitemap,/<url><loc>https:\/\/seo\.example\.com\/<\/loc><lastmod>[^<]+<\/lastmod><priority>1\.0<\/priority><\/url>/);
 assert.match(sitemap,/<url><loc>https:\/\/seo\.example\.com\/blog<\/loc><lastmod>[^<]+<\/lastmod><priority>0\.8<\/priority><\/url>/);
 assert.match(sitemap,/<url><loc>https:\/\/seo\.example\.com\/blog\/hello<\/loc><lastmod>[^<]+<\/lastmod><priority>0\.6<\/priority><\/url>/);
 assert.equal((sitemap.match(/<priority>/g)||[]).length,(sitemap.match(/<url>/g)||[]).length);
 const robots=await(await f.get('/robots.txt')).text();assert.match(robots,/Sitemap: https:\/\/seo.example.com\/sitemap.xml/);
 assert.match(await(await f.get('/robots.txt','unknown.example.com')).text(),/Disallow: \//);assert.equal((await f.get('/sitemap.xml','unknown.example.com')).status,404);
 const feed=await(await f.get('/feed.xml')).text();assert.match(feed,/Hello &lt;reader&gt;/);assert.doesNotMatch(feed,/Secret draft|Hidden sample/);
 const listing=await(await f.get('/blog')).text();assert.match(listing,/data-blog-link href="\/blog\/hello"/);assert.match(listing,/Hello &lt;reader&gt;/);assert.doesNotMatch(listing,/secret-draft/);
 const localListing=await(await f.get(`/sites/${project.slug}/blog`,'preview.example.com')).text();assert.match(localListing,new RegExp(`href="/sites/${project.slug}/blog/hello"`));
 await updatePage(store,project.id,post.id,{slug:'blog/draft-only',seo:{type:'article',noindex:true}});
 assert.match(await(await f.get('/sitemap.xml')).text(),/blog\/hello/);assert.match(await(await f.get('/blog/hello')).text(),/BlogPosting/);
 await restorePage(store,project.id,post.id,first.revision.id);assert.equal(store.read().pages.find(p=>p.id===post.id).seo.noindex,undefined);
 await updateProject(store,project.id,{seo:{noindex:true}});assert.equal(indexablePages(store.read(),store.read().projects.find(p=>p.id===project.id)).length,0);assert.match((await f.get('/blog/hello')).headers.get('x-robots-tag'),/noindex/);assert.match(await(await f.get('/robots.txt')).text(),/Disallow: \//);
});

test('SEO and blog media survive ZIP migration with fresh IDs and destination canonicals',async t=>{
 const {store,project}=await fixture(t),asset=await uploadAsset(store,project.id,{name:'logo.png',mime:'image/png',data:tinyPNG});
 await updateProject(store,project.id,{seo:{siteName:'Portable SEO',logo:asset.url,image:asset.url,favicon:asset.url,language:'en'}});
 const post=await createPage(store,project.id,{title:'Portable article',slug:'blog/portable',html:'<h1>Portable</h1>',seo:{type:'article',image:`https://${project.domain}${asset.url}`,canonical:`https://${project.domain}/blog/portable`,structuredData:{'@type':'Thing',url:`https://${project.domain}/blog/portable`,image:asset.url}}});await publishPage(store,project.id,post.id);
 const archive=await exportProject(store,project.id);
 const imported=await importProject(store,archive.buffer,{slug:'new-site',domain:'new.example.com',linkMode:'domain'});
 const state=store.read(),copy=state.pages.find(p=>p.projectId===imported.project.id&&p.slug===post.slug);
 assert.equal(copy.seo.canonical,'');assert.ok(copy.seo.image.includes(imported.project.id));assert.equal(copy.seo.image.includes(project.id),false);assert.equal(imported.project.seo.logo.includes(imported.project.id),true);assert.equal(copy.seo.structuredData.url,'https://new.example.com/blog/portable');
 const html=renderDocument(copy,{project:imported.project,instance:state.instance});assert.match(html,/href="https:\/\/new.example.com\/blog\/portable"/);assert.doesNotMatch(html,new RegExp(project.id));
 const media=state.assets.find(a=>a.projectId===imported.project.id);assert.deepEqual(await readFile(path.join(store.dataDir,'media',imported.project.id,media.filename)),tinyPNG);
});


test('MCP authors shared SEO and article metadata using the real SDK',async t=>{
 const {store,project,credentials,port,get}=await fixture(t);
 const tokens=JSON.parse(await readFile(path.join(store.dataDir,'credentials.json'),'utf8'));
 const client=new Client({name:'seo-test',version:'1.0.0'},{capabilities:{}});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${project.id}`),{requestInit:{headers:{authorization:`Bearer ${tokens.projectTokens[project.id]}`}}}));
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true);return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);};
 await call('project_update',{seo:{siteName:'MCP SEO',language:'en',favicon:'/media/favicon.png'}});
 const {page}=await call('page_upsert',{title:'An MCP article',slug:'blog/mcp-article',html:'<main><h1>An MCP article</h1></main>',seo:{type:'article',headline:'MCP headline',author:'MCP team',publishedTime:'2026-10-22T12:00:00.000Z',image:'/media/article.png',structuredData:{'@type':'Thing',name:'Extra context'}}});
 const draft=await call('page_get',{pageId:page.id});assert.equal(draft.page.seo.type,'article');
 await call('page_publish',{pageId:page.id});const html=await(await get('/blog/mcp-article')).text();assert.match(html,/MCP headline/);assert.ok(graph(html).some(n=>n['@type']==='BlogPosting'));assert.match(await(await get('/sitemap.xml')).text(),/mcp-article/);
 await client.close();
});


test('blog and RSS sort publication dates by instant across timezone offsets',()=>{
 const project={id:'p',name:'Dates',domain:'dates.example.com',slug:'dates'};
 const make=(id,date)=>({id,projectId:'p',pageId:id,createdAt:date,page:{id,projectId:'p',slug:`blog/${id}`,title:id,description:id,seo:{type:'article',publishedTime:date}}});
 const revisions=[make('older','2026-10-22T14:00:00+03:00'),make('newer','2026-10-22T12:00:00Z')];
 const state={instance:{},revisions,pages:revisions.map(r=>({...r.page,publishedRevisionId:r.id}))};
 const feed=feedXml(state,project),list=renderBlogList(state,project,'/');
 assert.ok(feed.indexOf('<title>newer</title>')<feed.indexOf('<title>older</title>'));
 assert.ok(list.indexOf('href="/blog/newer"')<list.indexOf('href="/blog/older"'));
});
