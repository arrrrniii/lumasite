// Rebuild repository illustrations and SEO examples from the real publishing code.
// Uses a disposable store; never reads or changes an installed website.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, updatePage, publishPage, renderDocument } from '../src/service.mjs';
import { sitemapXml, robotsTxt, feedXml, renderBlogBlocks } from '../src/seo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const images = path.join(root, 'docs/images'), examples = path.join(root, 'docs/examples');
await mkdir(images, { recursive: true }); await mkdir(examples, { recursive: true });
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (x, y, value, { size = 18, fill = '#17243b', weight = 400, mono = false, ...extra } = {}) => `<text x="${x}" y="${y}" font-family="${mono ? 'Menlo,Consolas,monospace' : 'Arial,Helvetica,sans-serif'}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${Object.entries(extra).map(([key,value]) => `${key}="${esc(value)}"`).join(' ')}>${esc(value)}</text>`;
const rect = (x,y,w,h,fill,r=12,stroke='none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const svg = (w,h,title,body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title"><title id="title">${esc(title)}</title>${body}</svg>`;

const questions = [
 ['What is your project named?', 'my-website'],
 ['Run locally or on a server? local/server', 'server'],
 ['Import a website ZIP?', 'Enter for a new website'],
 ['Website name', 'My Website'],
 ['Website domain (hostname only)', 'example.com'],
 ['Admin/API/MCP port', '4310'],
 ['Website/media port', '4311'],
 ['Studio URL', 'https://studio.example.com'],
 ['Preview URL', 'https://preview.example.com'],
 ['Reverse proxy: apache/caddy/none', 'apache'],
 ['Start LumaSite after setup? y/n', 'y'],
 ['Create this instance? y/n', 'y'],
];
let wizard = rect(0,0,1440,1080,'#f3f6fb',0)
 +text(48,58,'LUMASITE / FIRST RUN',{size:14,fill:'#2864eb',weight:700,'letter-spacing':2})
 +text(48,119,'From a name to your own website studio.',{size:39,weight:700})
 +text(48,159,'Server setup example · illustrated prompts from the v0.5 wizard',{size:20,fill:'#65748b'})
 +rect(48,203,920,680,'#101d32',18)+rect(48,203,920,54,'#1b2b44',18)
 +'<circle cx="75" cy="230" r="6" fill="#ff7777"/><circle cx="96" cy="230" r="6" fill="#ffd17c"/><circle cx="117" cy="230" r="6" fill="#79d6a6"/>'
 +text(149,236,'lumasite create',{size:15,fill:'#b4c4dd',mono:true})
 +text(78,299,'$ npx --yes "git+https://github.com/arrrrniii/lumasite.git#v0.5.0" create',{size:15,fill:'#f3f6ff',mono:true})
 +text(78,343,'Create a LumaSite website',{size:19,fill:'#fff',weight:600,mono:true});
questions.forEach(([question,answer], i) => {
 const y = 390+i*34;
 wizard += text(78,y,question,{size:15,fill:'#b4c4dd',mono:true})+text(592,y,answer,{size:15,fill:'#91baff',weight:600,mono:true});
});
wizard += text(78,834,'Review first. Project files are created after confirmation.',{size:15,fill:'#7fd7b0',mono:true});
const outputs = [
 ['01', 'WEBSITE', 'https://example.com/'],
 ['02', 'STUDIO', 'https://studio.example.com/admin'],
 ['03', 'MCP ENDPOINT', 'https://studio.example.com/mcp/', '<project-id> + Bearer token'],
];
outputs.forEach(([n,label,value,detail],i) => {
 const y=203+i*152;
 wizard += rect(996,y,396,133,'#fff',14,'#dce4ef')+text(1018,y+32,n,{size:12,fill:'#2864eb',weight:700})+text(1050,y+32,label,{size:12,fill:'#65748b',weight:700,'letter-spacing':1})+text(1018,y+70,value,{size:16,weight:600});
 if(detail) wizard += text(1018,y+101,detail,{size:14,fill:'#65748b'});
});
wizard += rect(996,677,396,206,'#e8f0ff',14)
 +text(1018,712,'Generated for you',{size:19,weight:700})
 +text(1018,748,'Project folder + npm scripts',{size:17})
 +text(1018,781,'Private data + new credentials',{size:17})
 +text(1018,814,'Apache configuration + next steps',{size:17})
 +text(1018,851,'Website name and domain can change later.',{size:14,fill:'#557299'});
const steps=[['1','Answer','New website or ZIP import'],['2','Review','Ports, URLs, name, and domain'],['3','Connect','Enable DNS, proxy, and HTTPS']];
steps.forEach(([n,title,detail],i)=>{
 const x=48+i*458;
 wizard+=rect(x,920,428,105,'#fff',12,'#dce4ef')+rect(x+19,940,37,37,'#edf3ff',9)+text(x+32,965,n,{size:18,fill:'#2864eb',weight:700})+text(x+74,960,title,{size:19,weight:700})+text(x+74,993,detail,{size:16,fill:'#65748b'});
});
wizard+=text(48,1057,'Local mode uses localhost URLs and skips the reverse-proxy question. No real credentials are shown.',{size:15,fill:'#65748b'});
await writeFile(path.join(images,'wizard-example.svg'),svg(1440,1080,'LumaSite server wizard example and generated website, Studio and MCP addresses',wizard));

let flow=rect(0,0,1440,630,'#f3f6fb',0)
 +text(48,57,'LUMASITE / SEO PUBLISHING',{size:14,fill:'#2864eb',weight:700,'letter-spacing':2})
 +text(48,114,'One article. A complete publishing path.',{size:39,weight:700})
 +text(48,153,'Metadata is part of the saved page, with outputs generated by the server.',{size:20,fill:'#65748b'});
const cards=[
 {x:48,n:'01',title:'Write & configure',lines:['Page title + useful content','/blog/welcome-email-checklist','Description + social image','Author + publication date'],badge:'Studio or MCP'},
 {x:515,n:'02',title:'Preview & publish',lines:['page_upsert → save draft','preview_url → signed preview','page_publish → new revision','Tailwind CSS compiled on publish'],badge:'No application redeploy'},
 {x:982,n:'03',title:'Generated outputs',lines:['HTML + canonical + social tags','Organization + BlogPosting','sitemap.xml + robots.txt','Blog listing + RSS feed'],badge:'Published content only'},
];
cards.forEach(({x,n,title,lines,badge})=>{
 flow+=rect(x,202,410,326,'#fff',14,'#dce4ef')+text(x+26,240,n,{size:14,fill:'#2864eb',weight:700})+text(x+26,282,title,{size:24,weight:700});
 lines.forEach((line,i)=>{flow+=text(x+26,326+i*36,line,{size:16,fill:'#526780'});});
 flow+=rect(x+25,473,360,31,'#edf3ff',7)+text(x+40,494,badge,{size:14,fill:'#2864eb',weight:600});
});
for(const x of [468,935]) flow+=`<path d="M${x} 362h34m-10-9 10 9-10 9" stroke="#2864eb" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
flow+=text(48,579,'Preview responses carry noindex. Canonical production URLs enter the sitemap after publication.',{size:18,fill:'#526780'})
 +text(48,611,'Search engines choose indexing and rankings; metadata does not guarantee either.',{size:16,fill:'#65748b'});
await writeFile(path.join(images,'seo-publishing.svg'),svg(1440,630,'Save, preview and publish an article to generate metadata, JSON-LD, sitemap and RSS',flow));

let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({deviceScaleFactor:1});
 for(const [name,w,h] of [['wizard-example',1440,1080],['seo-publishing',1440,630]]) {
  await page.setViewportSize({width:w,height:h});
  await page.setContent(`<html><head><style>html,body{margin:0;padding:0}</style></head><body>${await readFile(path.join(images,`${name}.svg`),'utf8')}</body></html>`);
  await page.screenshot({path:path.join(images,`${name}.png`)});
 }
} finally { await browser?.close(); }
// This optional capture is made from the real, included marketing example.
const studio = path.join(root,'test-results/sendmailos-studio-overview.png');
try { await copyFile(studio,path.join(images,'studio-overview.png')); }
catch(error) { if(error.code!=='ENOENT') throw error; }

const temp=await mkdtemp(path.join(os.tmpdir(),'lumasite-docs-'));
try {
 const input=JSON.parse(await readFile(path.join(examples,'seo-input.json'),'utf8'));
 const store=await openStore(temp);
 await initializeInstance(store,{password:'Disposable-Documentation-Example-2026',port:34310,sitePort:34311,publicUrl:'http://localhost:34310',sitePublicUrl:'http://localhost:34311'});
 const {project}=await createProject(store,input.project);
 const home=store.read().pages.find(p=>p.projectId===project.id);
 await updatePage(store,project.id,home.id,{title:'Example Studio — practical email guides',html:'<main><h1>Useful email starts here.</h1><p>Practical guides for thoughtful email teams.</p><a href="/blog">Read the blog</a></main>'});
 await publishPage(store,project.id,home.id);
 const blog=await createPage(store,project.id,{title:'Email guides | Example Studio',slug:'blog',description:'Practical email guides from Example Studio.',html:'<main><h1>Email guides</h1><!-- lumasite:blog-list --></main>'});
 await publishPage(store,project.id,blog.id);
 const article=await createPage(store,project.id,input.article);
 await publishPage(store,project.id,article.id);
 await createPage(store,project.id,{title:'A draft',slug:'unpublished-draft',html:'<h1>Work in progress</h1>'});
 const sample=await createPage(store,project.id,{title:'Sample for reviewers',slug:'samples/example',html:'<h1>Public sample</h1>',seo:{noindex:true}});
 await publishPage(store,project.id,sample.id);
 const state=store.read();
 const revision=state.revisions.find(r=>r.id===state.pages.find(p=>p.id===article.id).publishedRevisionId);
 const head=renderDocument(revision.page,{project,instance:state.instance,revisionId:revision.id}).match(/<head>([\s\S]*?)<\/head>/)[1];
 // Publish-time asset URLs are not meaningful outside the disposable instance;
 // this extract contains just the generated SEO head before runtime styles/scripts.
 const metadata=head.slice(0,head.indexOf('<link rel="stylesheet"'));
 const pretty=metadata.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/,(_,json)=>`<script type="application/ld+json">\n${JSON.stringify(JSON.parse(json),null,2)}\n</script>`).replace(/></g,'>\n<');
 await writeFile(path.join(examples,'seo-head.html'),`<!-- Generated by scripts/build-docs-assets.mjs from seo-input.json. Image URLs are illustrative. -->\n${pretty}\n`);
 const sitemap=sitemapXml(state,project);
 const robots=robotsTxt(project,state.instance,true);
 const rss=feedXml(state,project);
 assert.equal((sitemap.match(/<loc>/g)||[]).length,3);
 assert.ok(!sitemap.includes('unpublished-draft')&&!sitemap.includes('samples/example'));
 assert.ok(sitemap.includes('<priority>1.0</priority>')&&sitemap.includes('<priority>0.6</priority>'));
 assert.ok(rss.includes('welcome-email-checklist')&&!rss.includes('samples/example'));
 assert.ok(metadata.includes('<link rel="canonical" href="https://example.com/blog/welcome-email-checklist">'));
 assert.ok(metadata.includes('BlogPosting')&&metadata.includes('twitter:card'));
 const preview=renderDocument(revision.page,{project,instance:state.instance,preview:true});
 assert.ok(preview.includes('content="noindex,nofollow"'));
 const publishedBlog=renderBlogBlocks(blog.html,state,project,'/');
 assert.ok(publishedBlog.includes('/blog/welcome-email-checklist'));
 // A draft SEO edit must not silently change the published sitemap.
 await updatePage(store,project.id,article.id,{seo:{...input.article.seo,noindex:true}});
 assert.equal(sitemapXml(store.read(),project),sitemap);
 const prettyXml = xml => xml.replace(/></g,'>\n<')+'\n';
 await writeFile(path.join(examples,'sitemap.xml'),prettyXml(sitemap));
 await writeFile(path.join(examples,'robots.txt'),robots);
 await writeFile(path.join(examples,'feed.xml'),prettyXml(rss));
 console.log(JSON.stringify({images:['wizard-example.png','seo-publishing.png'],seoExample:{sitemapUrls:3,feedArticles:1,excludedDraft:true,excludedNoindex:true,publishedRevisionPreserved:true},credentialsExported:false}));
} finally { await rm(temp,{recursive:true,force:true}); }
