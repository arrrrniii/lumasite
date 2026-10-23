// Local integration check using macOS's Apache binary on disposable high ports.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {openStore} from '../src/store.mjs';
import {initializeInstance,createProject} from '../src/service.mjs';
import {startServers} from '../src/server.mjs';
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
if(process.platform!=='darwin')throw new Error('This local integration check requires macOS /usr/sbin/httpd. Run the portable API and browser tests on other platforms.');
const directory=await mkdtemp(path.join(os.tmpdir(),'lumasite-oauth-apache-')),adminPort=await port(),sitePort=await port(),proxyPort=await port(),origin=`http://127.0.0.1:${proxyPort}`,file=path.join(directory,'httpd.conf');
await mkdir(path.join(directory,'htdocs/.well-known/acme-challenge'),{recursive:true});await writeFile(path.join(directory,'htdocs/.well-known/acme-challenge/test'),'ACME preserved');
const store=await openStore(path.join(directory,'data'));await initializeInstance(store,{password:'Apache-Test-Password-2026!',port:adminPort,sitePort,publicUrl:origin});const project=await createProject(store,{name:'Apache OAuth test',slug:'apache-oauth'});const servers=await startServers({store});let child;
const metadataPaths=['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource'];
const config=fixed=>`ServerRoot "${directory}"
DefaultRuntimeDir "${directory}"
PidFile "${directory}/httpd.pid"
Listen 127.0.0.1:${proxyPort}
ServerName 127.0.0.1
User #${process.getuid()}
Group #${process.getgid()}
${['mpm_event','unixd','authz_core','log_config','proxy','proxy_http'].map(name=>`LoadModule ${name}_module /usr/libexec/apache2/mod_${name}.so`).join('\n')}
ErrorLog "${directory}/apache-error.log"
LogLevel warn
DocumentRoot "${directory}/htdocs"
<Directory "${directory}/htdocs">
  Require all granted
</Directory>
<VirtualHost 127.0.0.1:${proxyPort}>
  ServerName 127.0.0.1
  ProxyRequests Off
  ProxyPreserveHost On
${fixed?metadataPaths.map(p=>`  ProxyPass ${p} http://127.0.0.1:${adminPort}${p}`).join('\n'):''}
  ProxyPass /.well-known !
  ProxyPass / http://127.0.0.1:${adminPort}/
  ProxyPassReverse / http://127.0.0.1:${adminPort}/
</VirtualHost>
`;
async function start(fixed){await writeFile(file,config(fixed));child=spawn('/usr/sbin/httpd',['-f',file,'-DFOREGROUND'],{stdio:'ignore'});for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(await readFile(path.join(directory,'apache-error.log'),'utf8'));try{if((await fetch(origin+'/health')).ok)return;}catch{}await delay(50);}throw new Error('Disposable Apache did not start.');}
async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=null;}
try{
 await start(false);assert.equal((await fetch(origin+metadataPaths[0])).status,404,'Broad Virtualmin-style exclusion reproduces discovery failure');await stop();
 await start(true);
 const as=await fetch(origin+metadataPaths[0]);assert.equal(as.status,200);assert.equal((await as.json()).issuer,origin+'/');
 const resource=`${origin}/mcp/${project.project.id}`;
 assert.equal((await fetch(`${origin}${metadataPaths[1]}/mcp/${project.project.id}`)).status,200);
 assert.equal(await(await fetch(origin+'/.well-known/acme-challenge/test')).text(),'ACME preserved');
 let info,authorization;
 const provider={redirectUrl:'https://chatgpt.com/connector_platform_oauth_redirect',clientMetadata:{redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],client_name:'Apache discovery test',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},clientInformation:()=>info,saveClientInformation:value=>{info=value;},tokens:()=>undefined,saveTokens(){},saveCodeVerifier(){},codeVerifier:()=>'',redirectToAuthorization:value=>{authorization=value;}};
 assert.equal(await auth(provider,{serverUrl:resource}),'REDIRECT');
 const response=await fetch(authorization,{redirect:'manual'});assert.equal(response.status,303);assert.equal((await fetch(new URL(response.headers.get('location'),origin))).status,200);
 console.log(JSON.stringify({apache:'/usr/sbin/httpd',beforeFix:404,afterFix:200,acmePreserved:true,discovery:true,dynamicRegistration:true,authorization:true}));
}finally{await stop();await servers.close();await rm(directory,{recursive:true,force:true});}
