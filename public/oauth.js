(() => {
 'use strict';
 const id=new URL(location.href).searchParams.get('request');
 const status=document.getElementById('oauth-status'),error=document.getElementById('oauth-error'),login=document.getElementById('oauth-login'),approval=document.getElementById('oauth-approval');
 let details,busy=false;
 async function api(route,body){const response=await fetch(route,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Could not complete this connection.'),{status:response.status});return data;}
 function showError(message){error.textContent=message;error.hidden=false;}
 async function run(fn){if(busy)return;busy=true;error.hidden=true;document.querySelectorAll('button,input').forEach(el=>el.disabled=true);try{await fn();}catch(e){showError(e.message);}finally{busy=false;document.querySelectorAll('button,input').forEach(el=>el.disabled=false);}}
 async function load(){
  if(!id||!/^[A-Za-z0-9_-]{43}$/.test(id))throw new Error('Open a new connection request from your MCP client.');
  try{details=await api(`/api/oauth/requests/${encodeURIComponent(id)}`);}
  catch(e){if(e.status===401){login.hidden=false;approval.hidden=true;status.textContent='Sign in to review this connection.';login.elements.password.focus();return;}throw e;}
  login.hidden=true;approval.hidden=false;status.textContent='Review the app and website before allowing access.';
  for(const [key,value]of Object.entries({'oauth-client-name':details.clientName,'oauth-client-origin':details.redirectOrigin,'oauth-website-name':details.project.name,'oauth-website-domain':details.project.domain||`/sites/${details.project.slug}/`}))document.getElementById(key).textContent=value;
 }
 login.addEventListener('submit',event=>{event.preventDefault();const password=login.elements.password.value;run(async()=>{await api('/api/login',{password});login.reset();await load();});});
 async function decide(decision){if(!details)return;await run(async()=>{const response=await api(`/api/oauth/requests/${encodeURIComponent(id)}/decision`,{decision,csrfToken:details.csrfToken});const redirect=new URL(response.redirect);if(!['https:','http:'].includes(redirect.protocol))throw new Error('Invalid callback URL. Start again.');location.assign(redirect.href);});}
 document.getElementById('oauth-allow').addEventListener('click',()=>decide('allow'));
 document.getElementById('oauth-deny').addEventListener('click',()=>decide('deny'));
 load().catch(e=>{status.textContent='This connection could not be opened.';showError(e.message);});
})();
