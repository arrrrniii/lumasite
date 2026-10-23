import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject,updatePage,publishPage,uploadAsset,tokenMatches} from '../src/service.mjs';
import {exportProject} from '../src/migration.mjs';
import {startServers} from '../src/server.mjs';

async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const directory=await mkdtemp(path.join(os.tmpdir(),'lumasite-project-browser-')),results=path.resolve('test-results');
await mkdir(results,{recursive:true});
const port=await freePort(),sitePort=await freePort(),password='Project-Browser-Password-2026!';
const store=await openStore(path.join(directory,'target'));
await initializeInstance(store,{port,sitePort,password,publicUrl:`http://localhost:${port}`});
const target=await createProject(store,{name:'SendMailOS demo',slug:'sendmailos',domain:'sendmailos.example.test'});
const original=store.read().pages[0];await updatePage(store,target.project.id,original.id,{html:'<h1>Original target</h1>'});await publishPage(store,target.project.id,original.id);
const source=await openStore(path.join(directory,'source'));
await initializeInstance(source,{port:4300,sitePort:4301,password,publicUrl:'http://localhost:4300'});
const created=await createProject(source,{name:'ZIP source',slug:'zip-source'}),sourcePage=source.read().pages[0];
await updatePage(source,created.project.id,sourcePage.id,{html:'<h1>Published imported page</h1><a href="/">Home</a>'});await publishPage(source,created.project.id,sourcePage.id);
await uploadAsset(source,created.project.id,{name:'example.png',mime:'image/png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6PtQAAAAASUVORK5CYII=','base64')});
const archive=await exportProject(source,created.project.id),file=path.join(directory,'website.zip');await writeFile(file,archive.buffer);
const servers=await startServers({store});let browser;
const errors=[],completed=[];const step=async(name,fn)=>{await fn();completed.push(name);console.log(`PASS ${name}`);};
try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:980},reducedMotion:'reduce'});
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const idle=()=>page.waitForFunction(()=>document.getElementById('app')?.getAttribute('aria-busy')!=='true');
  const connections=async()=>{await page.getByRole('button',{name:'Connections',exact:true}).click();await idle();};
  await step('Open website management and inspect update mode on desktop and mobile',async()=>{
    await page.goto(`http://localhost:${port}/admin/projects/${target.project.id}`);
    await page.getByLabel('Admin password').fill(password);await page.getByRole('button',{name:'Open studio'}).click();await idle();
    await connections();await page.getByRole('heading',{name:'Manage website',exact:true}).waitFor();
    await page.getByRole('button',{name:'Update from ZIP',exact:true}).click();
    assert.equal(await page.getByLabel('Import action').inputValue(),'update');assert.equal(await page.locator('#import-submit').isDisabled(),true);
    await page.locator('#import-zip-file').setInputFiles(file);
    await page.getByLabel('Type sendmailos to confirm').fill('wrong');assert.equal(await page.locator('#import-submit').isDisabled(),true);
    await page.getByLabel('Type sendmailos to confirm').fill('sendmailos');assert.equal(await page.locator('#import-submit').isEnabled(),true);
    assert.equal(await page.getByLabel('Website links',{exact:true}).inputValue(),'domain');
    await page.screenshot({path:path.join(results,'website-update-desktop.png'),fullPage:false});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await page.locator('dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));
    }
    await page.screenshot({path:path.join(results,'website-update-mobile.png'),fullPage:false});await page.setViewportSize({width:1440,height:980});
  });
  await step('Switch modes without losing ZIP selection and reject conflicting new-website import',async()=>{
    await page.getByLabel('Import action').selectOption('create');await page.getByLabel('Project URL slug',{exact:true}).fill('sendmailos');
    await page.getByRole('button',{name:'Import website',exact:true}).click();await idle();
    await page.getByRole('alert').filter({hasText:/slug already exists/}).waitFor();
    assert.equal(await page.locator('#import-zip-file').evaluate(input=>input.files[0].name),'website.zip');
    assert.equal(await page.locator('#import-submit').isEnabled(),true);
    await page.getByLabel('Import action').selectOption('update');assert.equal(await page.locator('#import-submit').isDisabled(),true);
    await page.getByLabel('Type sendmailos to confirm').fill('sendmailos');
  });
  await step('Update existing website without duplication, keep MCP token, and download its recovery ZIP',async()=>{
    await page.getByRole('button',{name:'Update website',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await idle();
    assert.equal(store.read().projects.length,1);assert.equal(store.read().projects[0].id,target.project.id);assert.equal(store.read().projects[0].name,'SendMailOS demo');
    assert.equal(tokenMatches(target.token,store.read().projects[0].tokenHash),true);
    assert.match(await(await fetch(`http://localhost:${sitePort}/sites/sendmailos/`)).text(),/Published imported page/);
    await page.getByRole('button',{name:'View recovery ZIPs',exact:true}).click();await idle();
    assert.equal(await page.locator('.recovery-item').count(),1);
    const response=await page.request.get(new URL(await page.getByRole('link',{name:'Download ZIP',exact:true}).getAttribute('href'),page.url()).href);assert.equal(response.status(),200);assert.equal((await response.body()).readUInt32LE(0),0x04034b50);
    await page.getByRole('button',{name:'Close',exact:true}).click();
  });
  await step('Delete requires typed confirmation; deleted last website leaves recovery accessible',async()=>{
    await page.getByRole('button',{name:'Delete website',exact:true}).click();
    assert.equal(await page.locator('#delete-submit').isDisabled(),true);
    await page.getByLabel('Type sendmailos to confirm').fill('wrong');assert.equal(await page.locator('#delete-submit').isDisabled(),true);
    await page.getByLabel('Type sendmailos to confirm').fill('sendmailos');
    await page.screenshot({path:path.join(results,'website-delete-desktop.png'),fullPage:false});
    await page.locator('#delete-submit').click();await page.getByRole('heading',{name:'Your websites',exact:true}).waitFor();await idle();
    assert.equal(store.read().projects.length,0);assert.equal((await fetch(`http://localhost:${sitePort}/sites/sendmailos/`)).status,404);
    await page.getByRole('button',{name:'Recovery ZIPs',exact:true}).click();await idle();assert.equal(await page.locator('.recovery-item').count(),2);
    await page.getByRole('button',{name:'Close',exact:true}).click();
  });
  await step('Restore a deleted website from its recovery ZIP using the create import mode',async()=>{
    await page.getByRole('button',{name:'Import ZIP',exact:true}).click();
    assert.equal(await page.getByLabel('Import action').inputValue(),'create');
    const recovery=store.read().projectBackups.find(b=>b.reason==='delete');
    await page.locator('#import-zip-file').setInputFiles(path.join(store.dataDir,'project-backups',`${recovery.id}.zip`));
    await page.getByRole('button',{name:'Import website',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await idle();
    assert.equal(store.read().projects.length,1);assert.notEqual(store.read().projects[0].id,target.project.id);assert.equal(store.read().projects[0].slug,'sendmailos');
    assert.match(store.read().pages[0].html,/Published imported page/);
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:completed.length,checks:completed},null,2));
}finally{await browser?.close();await servers.close();await rm(directory,{recursive:true,force:true});}
