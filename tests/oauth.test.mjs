import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject,rotateProjectToken,updatePage} from '../src/service.mjs';
import {startServers} from '../src/server.mjs';
import {exportProject,importProject} from '../src/migration.mjs';
import {deleteProject} from '../src/project-lifecycle.mjs';
const sha=value=>createHash('sha256').update(value).digest('base64url');
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'lumasite-oauth-')),store=await openStore(directory),adminPort=await port(),sitePort=await port();
 const admin=`http://127.0.0.1:${adminPort}`,site=`http://127.0.0.1:${sitePort}`,credentials=await initializeInstance(store,{password:'OAuth-Example-Password-2026!',port:adminPort,sitePort,publicUrl:admin,sitePublicUrl:site});
 const first=await createProject(store,{name:'Website One',slug:'website-one'}),second=await createProject(store,{name:'Website Two',slug:'website-two'});
 let servers=await startServers({store});t.after(async()=>{await servers.close();await rm(directory,{recursive:true,force:true});});
 const auth={authorization:`Bearer ${credentials.adminToken}`},resource=`${admin}/mcp/${first.project.id}`;
 async function json(route,{method='GET',body,headers={},authenticated=false}={}){const response=await fetch(`${admin}${route}`,{method,redirect:'manual',headers:{...(authenticated?auth:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{response,data};}
 async function form(route,body){const response=await fetch(`${admin}${route}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});return{response,data:await response.json()};}
 async function register(extra={}){const result=await json('/register',{method:'POST',body:{client_name:'ChatGPT test',redirect_uris:[callback],token_endpoint_auth_method:'none',...extra}});assert.equal(result.response.status,201,JSON.stringify(result.data));return result.data;}
 async function begin(client,extra={}){const verifier=randomBytes(32).toString('base64url'),params={client_id:client.client_id,redirect_uri:callback,response_type:'code',code_challenge:sha(verifier),code_challenge_method:'S256',resource,scope:'website:manage',state:'state-sent-by-client',...extra};const response=await fetch(`${admin}/authorize?${new URLSearchParams(params)}`,{redirect:'manual'});return{response,verifier,params,id:new URL(response.headers.get('location')||'/invalid',admin).searchParams.get('request')};}
 async function approve(client,extra={}){const result=await begin(client,extra);assert.equal(result.response.status,303);const details=await json(`/api/oauth/requests/${result.id}`,{authenticated:true});assert.equal(details.response.status,200);const approved=await json(`/api/oauth/requests/${result.id}/decision`,{method:'POST',authenticated:true,body:{decision:'allow',csrfToken:details.data.csrfToken}});assert.equal(approved.response.status,200,JSON.stringify(approved.data));return{...result,redirect:new URL(approved.data.redirect),details:details.data};}
 async function exchange(client,flow,extra={}){return form('/token',{grant_type:'authorization_code',client_id:client.client_id,...(client.client_secret?{client_secret:client.client_secret}:{}),code:flow.redirect.searchParams.get('code'),code_verifier:flow.verifier,redirect_uri:flow.params.redirect_uri,resource:flow.params.resource,...extra});}
 async function mcp(token,projectId=first.project.id){const response=await fetch(`${admin}/mcp/${projectId}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'oauth-test',version:'1'}}})});await response.text();return response.status;}
 return{store,directory,admin,site,credentials,first,second,resource,auth,json,form,register,begin,approve,exchange,mcp,restart:async()=>{await servers.close();servers=await startServers({store});}};
}

test('OAuth discovery, DCR and PKCE consent produce a durable project-scoped token without exposing private credentials',async t=>{
 const f=await fixture(t);
 const denied=await f.json(`/mcp/${f.first.project.id}`);assert.equal(denied.response.status,401);assert.match(denied.response.headers.get('www-authenticate'),/resource_metadata=/);
 const meta=await f.json(`/.well-known/oauth-protected-resource/mcp/${f.first.project.id}`);assert.equal(meta.data.resource,f.resource);assert.deepEqual(meta.data.authorization_servers,[`${f.admin}/`]);
 const as=await f.json('/.well-known/oauth-authorization-server');assert.equal(as.data.issuer,`${f.admin}/`);assert.deepEqual(as.data.code_challenge_methods_supported,['S256']);assert.equal(as.data.authorization_response_iss_parameter_supported,true);assert.equal(as.data.registration_endpoint,`${f.admin}/register`);
 const client=await f.register(),flow=await f.approve(client);assert.equal(flow.redirect.origin,'https://chatgpt.com');assert.equal(flow.redirect.searchParams.get('state'),'state-sent-by-client');assert.equal(flow.redirect.searchParams.get('iss'),as.data.issuer);assert.equal(flow.details.project.id,f.first.project.id);assert.equal(flow.details.redirectOrigin,'https://chatgpt.com');
 const result=await f.exchange(client,flow);assert.equal(result.response.status,200,JSON.stringify(result.data));assert.equal(result.data.scope,'website:manage');assert.equal(await f.mcp(result.data.access_token),200);assert.equal(await f.mcp(result.data.access_token,f.second.project.id),401);
 assert.equal(await f.mcp(f.first.token),200);assert.equal(await f.mcp(f.credentials.adminToken),401);
 await f.restart();assert.equal(await f.mcp(result.data.access_token),200);assert.equal((await f.json('/api/projects/'+f.first.project.id+'/connections',{authenticated:true})).data.connections.length,1);
 const privateBytes=await readFile(path.join(f.directory,'oauth.json'),'utf8');for(const token of [result.data.access_token,result.data.refresh_token,flow.redirect.searchParams.get('code')])assert.equal(privateBytes.includes(token),false);
 assert.equal((await stat(path.join(f.directory,'oauth.json'))).mode&0o077,0);
 const archive=await exportProject(f.store,f.first.project.id);assert.ok(archive.buffer.length>0);
});

test('OAuth enforces redirect, resource, PKCE, client, scope, consent session and one-use code bindings',async t=>{
 const f=await fixture(t),client=await f.register(),other=await f.register({client_name:'Other client'});
 const unregistered=await f.begin(client,{redirect_uri:'https://evil.example/callback'});assert.equal(unregistered.response.status,400);assert.equal(unregistered.response.headers.has('location'),false);
 for(const extra of [{resource:'https://evil.example/mcp'},{resource:`${f.admin}/mcp/not-a-project`},{scope:'instance:admin'},{code_challenge:'short'}]){const invalid=await f.begin(client,extra);assert.equal(invalid.response.status,302);const redirect=new URL(invalid.response.headers.get('location'));assert.ok(redirect.searchParams.get('error'));assert.equal(redirect.searchParams.get('iss'),`${f.admin}/`);}
 const flow=await f.begin(client);assert.equal((await f.json(`/api/oauth/requests/${flow.id}`)).response.status,401);
 const details=await f.json(`/api/oauth/requests/${flow.id}`,{authenticated:true});
 assert.equal((await f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,body:{decision:'allow',csrfToken:'wrong'}})).response.status,403);
 assert.equal((await f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,body:{decision:'allow',csrfToken:'é'.repeat(details.data.csrfToken.length)}})).response.status,403);
 const login=await f.json('/api/login',{method:'POST',body:{password:f.credentials.password}}),cookie=login.response.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',headers:{cookie},body:{decision:'allow',csrfToken:details.data.csrfToken}})).response.status,403);
 assert.equal((await f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,headers:{origin:'https://evil.example'},body:{decision:'allow',csrfToken:details.data.csrfToken}})).response.status,403);
 const approved=await f.approve(client);
 for(const extra of [{code_verifier:randomBytes(32).toString('base64url')},{client_id:other.client_id},{resource:`${f.admin}/mcp/${f.second.project.id}`},{redirect_uri:'https://evil.example/callback'}])assert.equal((await f.exchange(client,approved,extra)).response.status,400);
 const noResource=await f.exchange(client,approved,{resource:''});assert.equal(noResource.response.status,400);
 assert.equal((await f.exchange(client,approved)).response.status,200);assert.equal((await f.exchange(client,approved)).response.status,400);
 const duplicate=await Promise.all([f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,body:{decision:'allow',csrfToken:details.data.csrfToken}}),f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,body:{decision:'allow',csrfToken:details.data.csrfToken}})]);
 assert.equal(duplicate.filter(r=>r.response.status===200).length,1);
});

test('OAuth supports confidential DCR clients, rotates refresh tokens and revokes the family on reuse',async t=>{
 const f=await fixture(t),client=await f.register({token_endpoint_auth_method:'client_secret_post'});assert.ok(client.client_secret);assert.equal(client.client_secret_expires_at,0);
 const flow=await f.approve(client);assert.equal((await f.exchange(client,flow,{client_secret:'wrong'})).response.status,400);
 const original=await f.exchange(client,flow);assert.equal(original.response.status,200);
 const refresh=extra=>f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,client_secret:client.client_secret,refresh_token:original.data.refresh_token,resource:f.resource,...extra});
 assert.equal((await refresh({resource:`${f.admin}/mcp/${f.second.project.id}`})).response.status,400);
 assert.equal((await refresh({scope:'admin'})).response.status,400);
 const rotated=await refresh();assert.equal(rotated.response.status,200);assert.notEqual(rotated.data.refresh_token,original.data.refresh_token);assert.equal(await f.mcp(rotated.data.access_token),200);
 assert.equal((await refresh()).response.status,400);assert.equal(await f.mcp(rotated.data.access_token),401);assert.equal(await f.mcp(original.data.access_token),401);
});

test('OAuth denial, administrative and token revocation, website replacement, rotation and deletion enforce access lifetime',async t=>{
 const f=await fixture(t),client=await f.register(),flow=await f.begin(client),details=await f.json(`/api/oauth/requests/${flow.id}`,{authenticated:true});
 const denied=await f.json(`/api/oauth/requests/${flow.id}/decision`,{method:'POST',authenticated:true,body:{decision:'deny',csrfToken:details.data.csrfToken}});const denial=new URL(denied.data.redirect);assert.equal(denial.searchParams.get('error'),'access_denied');assert.equal(denial.searchParams.get('iss'),`${f.admin}/`);assert.equal(denial.searchParams.get('state'),'state-sent-by-client');
 const first=await f.exchange(client,await f.approve(client)),listing=await f.json(`/api/projects/${f.first.project.id}/connections`,{authenticated:true}),id=listing.data.connections[0].id;
 assert.equal((await f.json(`/api/projects/${f.second.project.id}/connections/${id}/revoke`,{method:'POST',authenticated:true,body:{}})).response.status,404);
 assert.equal((await f.json(`/api/projects/${f.first.project.id}/connections/${id}/revoke`,{method:'POST',authenticated:true,body:{}})).response.status,200);assert.equal(await f.mcp(first.data.access_token),401);
 const second=await f.exchange(client,await f.approve(client));await f.form('/revoke',{client_id:client.client_id,token:second.data.refresh_token});assert.equal(await f.mcp(second.data.access_token),401);
 const third=await f.exchange(client,await f.approve(client)),archive=await exportProject(f.store,f.first.project.id);
 await importProject(f.store,archive.buffer,{mode:'update',projectId:f.first.project.id,confirmSlug:f.first.project.slug});assert.equal(await f.mcp(third.data.access_token),200);
 await rotateProjectToken(f.store,f.first.project.id);assert.equal(await f.mcp(third.data.access_token),401);
 const fourth=await f.exchange(client,await f.approve(client));await deleteProject(f.store,f.first.project.id,{confirmSlug:f.first.project.slug});assert.equal(await f.mcp(fourth.data.access_token),404);
});

test('OAuth rejects unsafe client metadata, protects consent APIs, isolates the public listener and rejects credential exports',async t=>{
 const f=await fixture(t);
 for(const extra of [{redirect_uris:['http://evil.example/callback']},{redirect_uris:['https://evil.example/callback#fragment']},{redirect_uris:['https://user:password@evil.example/callback']},{token_endpoint_auth_method:'client_secret_basic'},{grant_types:['client_credentials']}])assert.equal((await f.json('/register',{method:'POST',body:{redirect_uris:[callback],...extra}})).response.status,400);
 for(const route of ['/authorize','/token','/register','/oauth/consent','/.well-known/oauth-authorization-server',`/.well-known/oauth-protected-resource/mcp/${f.first.project.id}`])assert.equal((await fetch(f.site+route)).status,404);
 const consent=await fetch(f.admin+'/oauth/consent');assert.equal(consent.status,200);assert.match(consent.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const client=await f.register({token_endpoint_auth_method:'client_secret_post'}),page=f.store.read().pages.find(p=>p.projectId===f.first.project.id);
 await updatePage(f.store,f.first.project.id,page.id,{html:`<p>${client.client_secret}</p>`});await assert.rejects(exportProject(f.store,f.first.project.id),e=>e.status===400&&/OAuth client credential/.test(e.message));
 await updatePage(f.store,f.first.project.id,page.id,{html:`<p>ls_oauth_${randomBytes(32).toString('base64url')}</p>`});await assert.rejects(exportProject(f.store,f.first.project.id),e=>e.status===400&&/access credential/.test(e.message));
});

test('OAuth expiry applies to pending requests, authorization codes, access tokens and absolute refresh lifetime',async t=>{
 const f=await fixture(t);t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const client=await f.register(),pending=await f.begin(client);t.mock.timers.tick(601000);
 assert.equal((await f.json(`/api/oauth/requests/${pending.id}`,{authenticated:true})).response.status,400);
 const code=await f.approve(client);t.mock.timers.tick(121000);assert.equal((await f.exchange(client,code)).response.status,400);
 const flow=await f.approve(client),tokens=await f.exchange(client,flow);assert.equal(tokens.response.status,200);
 t.mock.timers.tick(3601000);assert.equal(await f.mcp(tokens.data.access_token),401);
 const refresh=await f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.data.refresh_token,resource:f.resource});assert.equal(refresh.response.status,200);assert.equal(await f.mcp(refresh.data.access_token),200);
 t.mock.timers.tick(30*86400000);assert.equal((await f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:refresh.data.refresh_token,resource:f.resource})).response.status,400);
});
