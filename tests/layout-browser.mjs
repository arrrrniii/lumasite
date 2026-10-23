import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openStore } from '../src/store.mjs';
import { initializeInstance, createProject, createPage, updatePage, publishPage } from '../src/service.mjs';
import { updateLayout, publishLayout } from '../src/layout.mjs';
import { startServers } from '../src/server.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const dir=await mkdtemp(path.join(os.tmpdir(),'lumasite-layout-browser-')),store=await openStore(dir),adminPort=await port(),sitePort=await port(),admin=`http://localhost:${adminPort}`,production=`http://layout.example.com:${sitePort}`;
await initializeInstance(store,{password:'Layout-browser-123!',port:adminPort,sitePort,publicUrl:admin});
const {project}=await createProject(store,{name:'Shared layout example',domain:'layout.example.com'}),home=store.read().pages[0];
await updateLayout(store,project.id,{header:'<header><a href="/">Shared navigation</a><button id="shared-action">Try shared action</button></header>',footer:'<footer>Shared footer</footer>',css:'header,footer{padding:32px;background:#10203a;color:white}main{padding:48px}header{display:flex;gap:30px}',js:'window.sharedRuns=(window.sharedRuns||0)+1;document.querySelector("#shared-action").onclick=()=>document.body.dataset.sharedClicked="yes";'});await publishLayout(store,project.id,{expectedRevision:1});
await updatePage(store,project.id,home.id,{layoutMode:'global',html:'<main><h1>Home content</h1></main>',css:'',js:''});await publishPage(store,project.id,home.id);
const blog=await createPage(store,project.id,{slug:'blog/article',title:'Article',html:'<main><h1>Article content</h1></main>'});await publishPage(store,project.id,blog.id);
const beforePages=JSON.stringify(store.read().pages),beforeRevisions=JSON.stringify(store.read().revisions),servers=await startServers({store});let browser;
const results=path.resolve('test-results');await mkdir(results,{recursive:true});
try{
 browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP layout.example.com 127.0.0.1','--no-proxy-server']});const page=await browser.newPage({viewport:{width:1512,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(admin+'/admin');await page.getByLabel('Admin password',{exact:true}).fill('Layout-browser-123!');await page.getByRole('button',{name:'Open studio',exact:true}).click();await page.getByRole('button',{name:/Shared layout example/}).click();await page.getByRole('button',{name:'Global layout',exact:true}).click();await page.getByRole('heading',{name:'One layout. Every page.'}).waitFor();
 await page.locator('#layout-source').fill('<header><a href="/">Updated shared navigation</a><button id="shared-action">Try shared action</button></header>');
 await page.getByRole('tab',{name:'Footer',exact:true}).click();await page.locator('#layout-source').fill('<footer>Updated shared footer</footer>');await page.getByRole('tab',{name:'Header',exact:true}).click();assert.match(await page.locator('#layout-source').inputValue(),/Updated shared navigation/);
 const live=await browser.newPage();live.on('pageerror',e=>errors.push(e.message));await live.goto(production+'/');await live.getByText('Shared footer',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Save layout draft',exact:true}).click();await page.getByText('Layout draft saved. Your live website is unchanged.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.sharedRuns),undefined);
 await live.reload();await live.getByText('Shared footer',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview saved layout',exact:true}).click();const frame=page.frameLocator('iframe[title="Global layout draft preview"]');await frame.getByText('Updated shared footer',{exact:true}).waitFor();await frame.getByRole('button',{name:'Try shared action',exact:true}).click();assert.equal(await frame.locator('body').getAttribute('data-shared-clicked'),'yes');
 console.log('PASS shared draft editing, source tabs, isolated preview and global script behavior');
 await page.getByRole('button',{name:'Publish layout',exact:true}).click();await page.getByText('Layout published to every linked page.',{exact:true}).waitFor();
 for(const route of ['/','/blog/article']){await live.goto(production+route);await live.getByText('Updated shared footer',{exact:true}).waitFor();assert.equal(await live.evaluate(()=>window.sharedRuns),1);assert.equal(await live.locator('header').count(),1);}
 assert.equal(JSON.stringify(store.read().pages),beforePages);assert.equal(JSON.stringify(store.read().revisions),beforeRevisions);
 await page.getByRole('button',{name:'Restore draft',exact:true}).last().click();await page.getByText('Layout version restored to draft. Preview before publishing.',{exact:true}).waitFor();await live.reload();await live.getByText('Updated shared footer',{exact:true}).waitFor();
 console.log('PASS one layout publication updates existing pages without republishing bodies; history restores stay drafts');
 await page.locator('#main').focus();await page.evaluate(()=>{scrollTo(0,0);document.getElementById('notifications').replaceChildren()});await page.screenshot({path:path.join(results,'studio-global-layout.png'),fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.getByRole('button',{name:'Publish layout',exact:true}).isVisible());}
 await page.screenshot({path:path.join(results,'studio-global-layout-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS responsive layout dashboard at 320/390 px and no browser errors');
}finally{await browser?.close();await servers.close();await rm(dir,{recursive:true,force:true});}
