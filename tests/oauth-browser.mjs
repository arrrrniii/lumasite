import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject} from '../src/service.mjs';
import {startServers} from '../src/server.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const directory=await mkdtemp(path.join(os.tmpdir(),'lumasite-oauth-browser-')),results=path.resolve('test-results');await mkdir(results,{recursive:true});
const adminPort=await port(),sitePort=await port(),password='OAuth-Browser-Password-2026!',store=await openStore(directory),admin=`http://127.0.0.1:${adminPort}`;
await initializeInstance(store,{port:adminPort,sitePort,password,publicUrl:admin});const project=await createProject(store,{name:'SendMailOS OAuth demo',slug:'sendmailos',domain:'sendmailos.example.test'}),resource=`${admin}/mcp/${project.project.id}`;
const servers=await startServers({store});let browser,client;
let resultUrl;
const callbackServer=createServer((req,res)=>{resultUrl=new URL(req.url,`http://127.0.0.1:${callbackServer.address().port}`);res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><title>Connection result</title></head><body><h1>Connection result received</h1></body></html>');});await new Promise(r=>callbackServer.listen(0,'127.0.0.1',r));
const redirectUrl=`http://127.0.0.1:${callbackServer.address().port}/callback`;
let clientInfo,tokens,verifier,authorizationUrl;
const provider={redirectUrl,clientMetadata:{client_name:'ChatGPT browser demo',redirect_uris:[redirectUrl],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},state:()=> 'browser-callback-state',clientInformation:()=>clientInfo,saveClientInformation:value=>{clientInfo=value;},tokens:()=>tokens,saveTokens:value=>{tokens=value;},saveCodeVerifier:value=>{verifier=value;},codeVerifier:()=>verifier,redirectToAuthorization:value=>{authorizationUrl=value;}};
const completed=[],errors=[];const step=async(name,fn)=>{await fn();completed.push(name);console.log(`PASS ${name}`);};
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:980},reducedMotion:'reduce'});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await step('A real MCP SDK client discovers OAuth and dynamically registers without manual client credentials',async()=>{assert.equal(await auth(provider,{serverUrl:resource}),'REDIRECT');assert.ok(clientInfo.client_id);assert.equal(authorizationUrl.searchParams.get('resource'),resource);assert.equal(authorizationUrl.searchParams.get('code_challenge_method'),'S256');});
 await step('Consent requires Studio login and displays the requested website, app and callback origin',async()=>{
  await page.goto(authorizationUrl.href);await page.getByRole('button',{name:'Sign in to review'}).waitFor();await page.getByLabel('Admin password').fill(password);await page.getByRole('button',{name:'Sign in to review'}).click();await page.getByRole('button',{name:'Allow website access'}).waitFor();
  assert.equal(await page.locator('#oauth-website-name').innerText(),'SendMailOS OAuth demo');assert.equal(await page.locator('#oauth-client-name').innerText(),'ChatGPT browser demo');assert.equal(await page.locator('#oauth-client-origin').innerText(),new URL(redirectUrl).origin);
  await page.screenshot({path:path.join(results,'oauth-consent-desktop.png'),fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:path.join(results,'oauth-consent-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:980});
 });
 await step('Approval returns state and issuer; the SDK exchanges the code and uses tools with its OAuth token',async()=>{
  await page.getByRole('button',{name:'Allow website access'}).click();await page.waitForURL(`${redirectUrl}*`);assert.equal(resultUrl.searchParams.get('state'),'browser-callback-state');assert.equal(resultUrl.searchParams.get('iss'),`${admin}/`);
  assert.equal(await auth(provider,{serverUrl:resource,authorizationCode:resultUrl.searchParams.get('code')}),'AUTHORIZED');assert.ok(tokens.access_token.startsWith('ls_oauth_'));
  client=new Client({name:'oauth-browser-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{authProvider:provider}));const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='page_publish'));const projectRead=await client.callTool({name:'project_get',arguments:{}});assert.equal(projectRead.structuredContent.project.id,project.project.id);await client.close();client=null;
 });
 await step('Studio lists the OAuth connection and revocation immediately disables the client token',async()=>{
  await page.goto(`${admin}/admin/projects/${project.project.id}`);await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('heading',{name:'Connected apps',exact:true}).waitFor();await page.getByRole('heading',{name:'ChatGPT browser demo',exact:true}).waitFor();
  await page.getByRole('button',{name:'Revoke access',exact:true}).click();await page.getByText('No apps connected yet.',{exact:false}).waitFor();
  const response=await fetch(resource,{headers:{authorization:`Bearer ${tokens.access_token}`}});assert.equal(response.status,401);
 });
 await step('A later consent can be denied and the callback receives access_denied with issuer and state',async()=>{
  tokens=undefined;assert.equal(await auth(provider,{serverUrl:resource}),'REDIRECT');await page.goto(authorizationUrl.href);await page.getByRole('button',{name:'Deny access'}).waitFor();await page.getByRole('button',{name:'Deny access'}).click();await page.waitForURL(`${redirectUrl}*`);assert.equal(resultUrl.searchParams.get('error'),'access_denied');assert.equal(resultUrl.searchParams.get('iss'),`${admin}/`);assert.equal(resultUrl.searchParams.get('state'),'browser-callback-state');
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:completed.length,checks:completed,browserErrors:errors.length}));
}finally{await client?.close();await browser?.close();await new Promise(r=>callbackServer.close(r));await servers.close();await rm(directory,{recursive:true,force:true});}
