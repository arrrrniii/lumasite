// OAuth transport and protocol validation use the MCP SDK. The provider keeps
// website grants separate from portable content and never stores raw user tokens.
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {authorizationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import {tokenHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import {clientRegistrationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import {revocationHandler} from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {InvalidClientMetadataError,InvalidGrantError,InvalidRequestError,InvalidScopeError,InvalidTargetError,InvalidTokenError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {atomicWrite} from './store.mjs';
import {fail,requireProject,publicProject} from './service.mjs';

export const OAUTH_SCOPE='website:manage';
const seconds=()=>Math.floor(Date.now()/1000),hash=value=>createHash('sha256').update(String(value)).digest('hex');
const secret=prefix=>`ls_${prefix}_${randomBytes(32).toString('base64url')}`;
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length>256||b.length>256)return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACCESS_SECONDS=3600,GRANT_SECONDS=30*86400,PENDING_SECONDS=600,CODE_SECONDS=120;

export async function createOAuthService(store,publicUrl){
 const issuerUrl=new URL(publicUrl);
 if(issuerUrl.protocol!=='https:'&&!(issuerUrl.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(issuerUrl.hostname)))throw new Error('OAuth requires an HTTPS Studio URL, or loopback HTTP for local development.');
 const issuer=issuerUrl.href,file=path.join(store.dataDir,'oauth.json'),pending=new Map();
 let data;
 try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;data={version:1,clients:[],codes:[],grants:[]};}
 if(data.version!==1||!['clients','codes','grants'].every(key=>Array.isArray(data[key])))throw new Error('Invalid private OAuth state. Restore its backup before starting.');
 let queue=Promise.resolve();
 const mutate=fn=>{
  const operation=queue.then(async()=>{const next=structuredClone(data);const result=await fn(next);await atomicWrite(file,JSON.stringify(next,null,2));data=next;return result;});
  queue=operation.catch(()=>{});return operation;
 };
 const projectForResource=resource=>{
  const value=resource?.href,base=store.read().instance?.publicUrl;
  if(!base||new URL(base).href!==issuer||typeof value!=='string')throw new InvalidTargetError('Choose the exact website MCP URL as resource.');
  const match=new URL(value).pathname.match(/^\/mcp\/([a-f0-9-]+)$/i);
  if(!match||!uuid.test(match[1])||value!==new URL(`/mcp/${match[1]}`,issuer).href)throw new InvalidTargetError('Resource must identify one website on this Studio.');
  const project=store.read().projects.find(p=>p.id===match[1]);if(!project)throw new InvalidTargetError('Website no longer exists.');return project;
 };
 const active=grant=>{
  if(!grant||grant.revokedAt||grant.expiresAt<=seconds()||grant.issuer!==issuer||grant.instanceId!==store.read().instance?.id)return false;
  const project=store.read().projects.find(p=>p.id===grant.projectId);
  return !!project&&project.tokenHash===grant.projectTokenHash;
 };
 const callback=(item,values)=>{const redirect=new URL(item.redirectUri);for(const[k,v]of Object.entries({...values,...(item.state?{state:item.state}:{}),iss:issuer}))redirect.searchParams.set(k,v);return redirect.href;};
 const prune=next=>{next.codes=next.codes.filter(c=>c.expiresAt>seconds());next.grants=next.grants.filter(g=>g.expiresAt>seconds()&&!g.revokedAt);};
 const issued=()=>({access_token:secret('oauth'),refresh_token:secret('refresh'),token_type:'Bearer',expires_in:ACCESS_SECONDS,scope:OAUTH_SCOPE});
 const recordTokens=(grant,tokens)=>{
  grant.accessTokens=(grant.accessTokens||[]).filter(t=>t.expiresAt>seconds());
  grant.accessTokens.push({hash:hash(tokens.access_token),expiresAt:seconds()+ACCESS_SECONDS});
  grant.refreshHash=hash(tokens.refresh_token);
 };
 const provider={
  clientsStore:{
   getClient:async id=>structuredClone(data.clients.find(c=>c.client_id===id)),
   registerClient:async client=>{
    if(!['none','client_secret_post'].includes(client.token_endpoint_auth_method||'client_secret_post'))throw new InvalidClientMetadataError('Supported client authentication: none or client_secret_post.');
    if(!client.redirect_uris.length||client.redirect_uris.length>10||String(client.client_name||'').length>100)throw new InvalidClientMetadataError('Use a short client name and at most ten exact redirect URLs.');
    for(const value of client.redirect_uris){const url=new URL(value);if(value.length>2048||url.username||url.password||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new InvalidClientMetadataError('Redirect URLs must use HTTPS or a loopback HTTP address, without credentials or fragments.');}
    if(client.grant_types?.some(type=>!['authorization_code','refresh_token'].includes(type))||client.response_types?.some(type=>type!=='code'))throw new InvalidClientMetadataError('Use authorization_code with optional refresh_token and code responses.');
    const registered={client_id:client.client_id,client_id_issued_at:client.client_id_issued_at,client_name:client.client_name||'MCP client',redirect_uris:client.redirect_uris,token_endpoint_auth_method:client.token_endpoint_auth_method||'client_secret_post',grant_types:['authorization_code','refresh_token'],response_types:['code'],...(client.client_secret?{client_secret:client.client_secret,client_secret_expires_at:0}:{})};
    await mutate(next=>{if(next.clients.length>=1000)throw new InvalidClientMetadataError('OAuth client capacity reached. Contact the Studio administrator.');next.clients.push(registered);});return registered;
   }
  },
  authorize:async(client,params,res)=>{
   const project=projectForResource(params.resource);
   if(params.scopes?.some(scope=>scope!==OAUTH_SCOPE))throw new InvalidScopeError('Only website:manage is supported.');
   if(!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)||String(params.state||'').length>4096)throw new InvalidRequestError('Use a valid S256 PKCE challenge and bounded state.');
   for(const[id,item]of pending)if(item.expiresAt<=seconds())pending.delete(id);
   if(pending.size>=1000)throw new InvalidRequestError('Too many pending authorization requests. Try again later.');
   const id=randomBytes(32).toString('base64url');
   pending.set(id,{clientId:client.client_id,clientName:client.client_name,projectId:project.id,projectTokenHash:project.tokenHash,resource:params.resource.href,redirectUri:params.redirectUri,state:params.state,codeChallenge:params.codeChallenge,expiresAt:seconds()+PENDING_SECONDS});
   res.redirect(303,`/oauth/consent?request=${id}`);
  },
  challengeForAuthorizationCode:async(client,code)=>{
   const item=data.codes.find(item=>item.hash===hash(code));
   if(!item||item.clientId!==client.client_id||item.expiresAt<=seconds())throw new InvalidGrantError('Authorization code is invalid or expired.');return item.codeChallenge;
  },
  exchangeAuthorizationCode:async(client,code,_verifier,redirectUri,resource)=>mutate(next=>{
   prune(next);const item=next.codes.find(item=>item.hash===hash(code));
   if(!item||item.clientId!==client.client_id||item.redirectUri!==redirectUri||item.resource!==resource?.href||!active(item))throw new InvalidGrantError('Authorization code, redirect, or resource is invalid.');
   const grant={...item,id:randomUUID(),createdAt:new Date().toISOString(),expiresAt:seconds()+GRANT_SECONDS,accessTokens:[],usedRefreshHashes:[]};delete grant.hash;delete grant.codeChallenge;delete grant.redirectUri;delete grant.state;
   if(next.grants.length>=1000)throw new InvalidGrantError('OAuth connection capacity reached. Revoke unused connections.');
   const tokens=issued();recordTokens(grant,tokens);next.codes=next.codes.filter(c=>c!==item);next.grants.push(grant);return tokens;
  }),
  exchangeRefreshToken:async(client,token,scopes,resource)=>{
   let replay=false;
   const result=await mutate(next=>{
    prune(next);const tokenHash=hash(token),grant=next.grants.find(g=>g.clientId===client.client_id&&(g.refreshHash===tokenHash||g.usedRefreshHashes.includes(tokenHash)));
    if(!active(grant)||grant.resource!==resource?.href)throw new InvalidGrantError('Refresh token or resource is invalid.');
    if(grant.usedRefreshHashes.includes(tokenHash)){grant.revokedAt=new Date().toISOString();replay=true;return null;}
    if(scopes?.some(scope=>scope!==OAUTH_SCOPE))throw new InvalidScopeError('Scope expansion is not permitted.');
    if(grant.usedRefreshHashes.length>=4096)throw new InvalidGrantError('Reconnect this client to renew its authorization.');
    grant.usedRefreshHashes.push(tokenHash);const tokens=issued();recordTokens(grant,tokens);return tokens;
   });
   if(replay)throw new InvalidGrantError('Refresh token reuse detected. Reconnect this client.');return result;
  },
  verifyAccessToken:async token=>{
   const tokenHash=hash(token),grant=data.grants.find(g=>g.accessTokens.some(t=>t.hash===tokenHash&&t.expiresAt>seconds()));
   if(!active(grant))throw new InvalidTokenError('Access token is invalid, expired, or revoked.');
   return{token,clientId:grant.clientId,scopes:[OAUTH_SCOPE],expiresAt:grant.accessTokens.find(t=>t.hash===tokenHash).expiresAt,resource:new URL(grant.resource),extra:{projectId:grant.projectId}};
  },
  revokeToken:async(client,request)=>mutate(next=>{const value=hash(request.token);for(const grant of next.grants)if(grant.clientId===client.client_id&&(grant.refreshHash===value||grant.usedRefreshHashes.includes(value)||grant.accessTokens.some(t=>t.hash===value)))grant.revokedAt=new Date().toISOString();})
 };
 const metadata={issuer,authorization_endpoint:new URL('/authorize',issuer).href,token_endpoint:new URL('/token',issuer).href,registration_endpoint:new URL('/register',issuer).href,revocation_endpoint:new URL('/revoke',issuer).href,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_post'],revocation_endpoint_auth_methods_supported:['none','client_secret_post'],scopes_supported:[OAUTH_SCOPE],authorization_response_iss_parameter_supported:true};
 const router=express.Router();
 router.get('/.well-known/oauth-authorization-server',(_req,res)=>res.set('Access-Control-Allow-Origin','*').json(metadata));
 router.get('/.well-known/oauth-protected-resource/mcp/:id',(req,res)=>{
  const project=requireProject(store.read(),req.params.id);res.set('Access-Control-Allow-Origin','*').json({resource:new URL(`/mcp/${project.id}`,issuer).href,authorization_servers:[issuer],scopes_supported:[OAUTH_SCOPE],resource_name:project.name,bearer_methods_supported:['header']});
 });
 // SDK error redirects also need RFC 9207 issuer identification.
 router.use('/authorize',(_req,res,next)=>{const redirect=res.redirect.bind(res);res.redirect=(status,location)=>{if(typeof status==='string'){location=status;status=302;}const url=new URL(location,issuer);if(!String(location).startsWith('/oauth/consent?request=')){url.searchParams.set('iss',issuer);location=url.href;}return redirect(status,location);};next();});
 const limits={validate:{xForwardedForHeader:false}}; // Rate-limit the real socket; never trust client-supplied forwarding headers.
 router.use('/authorize',authorizationHandler({provider,rateLimit:limits}));
 router.use('/token',tokenHandler({provider,rateLimit:limits}));
 router.use('/register',clientRegistrationHandler({clientsStore:provider.clientsStore,clientSecretExpirySeconds:0,rateLimit:limits}));
 router.use('/revoke',revocationHandler({provider,rateLimit:limits}));
 function pendingRequest(id){const item=pending.get(id);if(!item||item.expiresAt<=seconds())fail(400,'This connection request expired. Start again from your MCP client.');if(!store.read().projects.some(p=>p.id===item.projectId&&p.tokenHash===item.projectTokenHash))fail(409,'This website or its access changed. Start again.');return item;}
 return{
  router,provider,issuer,
  challenge:projectId=>`Bearer resource_metadata="${new URL(`/.well-known/oauth-protected-resource/mcp/${projectId}`,issuer).href}", scope="${OAUTH_SCOPE}"`,
  requestDetails:(id,binding)=>{const item=pendingRequest(id);if(item.processing)fail(409,'This authorization is being processed.');if(item.binding!==binding){item.binding=binding;item.csrf=secret('csrf');}return{clientName:item.clientName,redirectOrigin:new URL(item.redirectUri).origin,project:publicProject(requireProject(store.read(),item.projectId)),scope:OAUTH_SCOPE,csrfToken:item.csrf};},
  decide:async(id,binding,{decision,csrfToken}={})=>{
   const item=pendingRequest(id);if(item.binding!==binding||!same(item.csrf,csrfToken))fail(403,'Invalid consent session. Refresh this connection request.');if(!['allow','deny'].includes(decision))fail(400,'Choose allow or deny.');if(item.processing)fail(409,'This authorization is being processed.');item.processing=true;
   try{
    if(decision==='deny'){pending.delete(id);return{redirect:callback(item,{error:'access_denied',error_description:'The Studio administrator declined access.'})};}
    const code=secret('code');
    await mutate(next=>{prune(next);const current=pendingRequest(id);next.codes.push({...current,hash:hash(code),issuer,instanceId:store.read().instance.id,expiresAt:seconds()+CODE_SECONDS});const saved=next.codes.at(-1);for(const key of ['binding','csrf','processing','clientName'])delete saved[key];});
    pending.delete(id);return{redirect:callback(item,{code})};
   }catch(error){item.processing=false;throw error;}
  },
  listConnections:projectId=>{requireProject(store.read(),projectId);return data.grants.filter(g=>g.projectId===projectId&&active(g)).map(g=>({id:g.id,clientName:data.clients.find(c=>c.client_id===g.clientId)?.client_name||'MCP client',createdAt:g.createdAt,expiresAt:g.expiresAt,scope:OAUTH_SCOPE}));},
  revokeConnection:async(projectId,id)=>{requireProject(store.read(),projectId);await mutate(next=>{const grant=next.grants.find(g=>g.projectId===projectId&&g.id===id);if(!grant)fail(404,'Connection not found.');grant.revokedAt=new Date().toISOString();});return{ok:true};}
 };
}
