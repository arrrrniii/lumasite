import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {zipSync} from 'fflate';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const folder=path.join(root,'marketing/assets/brand');await mkdir(folder,{recursive:true});
const reference=await readFile(path.join(folder,'dashboard-favicon-reference.png'));
const font=(await readFile(path.join(root,'marketing/assets/fonts/soravariable.woff2'))).toString('base64');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
 await page.setContent(`<img src="data:image/png;base64,${reference.toString('base64')}" width="300" height="300">`);
 const palette=await page.locator('img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data,m=new Map();for(let i=0;i<p.length;i+=4)if(p[i+3]===255){const key=[p[i],p[i+1],p[i+2]].join(',');m.set(key,(m.get(key)||0)+1);}return [...m].sort((a,b)=>b[1]-a[1]).slice(0,4);});
 const indigo='#'+palette[0][0].split(',').map(n=>Number(n).toString(16).padStart(2,'0')).join('');
 const symbol=`<circle cx="32" cy="32" r="32" fill="${indigo}"/><path d="M47.2 16.8 35.7 50.5 28.3 35.5 12.7 28.5Z M47.2 16.8 28.3 35.5" fill="none" stroke="#fff" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>`;
 const mark=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="SendMailOS paper plane">${symbol}</svg>`;
 await writeFile(path.join(folder,'sendmailos-mark.svg'),mark);
 const wordmark=ink=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 64" role="img" aria-label="SendMailOS"><style>@font-face{font-family:Sora;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}</style>${symbol}<text x="80" y="43.5" font-family="Sora,sans-serif" font-weight="600" font-size="35" letter-spacing="-1.5" fill="${ink}">sendmailos<tspan fill="#4f8cff">.</tspan></text></svg>`;
 for(const [variant,ink]of [['dark','#f5f8ff'],['light','#07101d']]){
  const svg=wordmark(ink);await writeFile(path.join(folder,`sendmailos-wordmark-${variant}.svg`),svg);
  await page.setViewportSize({width:1400,height:256});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:1400px;height:256px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await page.locator('img').evaluate(e=>e.decode());await page.screenshot({path:path.join(folder,`sendmailos-wordmark-${variant}.png`),omitBackground:true});
 }
 await page.setViewportSize({width:900,height:250});
 await page.setContent(`<style>html,body{margin:0;width:900px;height:250px;background:#07101d}body{display:grid;place-items:center}img{width:700px;height:128px}</style><img src="data:image/svg+xml;base64,${Buffer.from(wordmark('#f5f8ff')).toString('base64')}">`);
 await page.locator('img').evaluate(e=>e.decode());await page.screenshot({path:path.join(folder,'sendmailos-logo-preview.png')});
 for(const size of [64,180,512]){
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}">`);
  await page.locator('img').evaluate(e=>e.decode());await page.screenshot({path:path.join(folder,`sendmailos-icon-${size}.png`),omitBackground:true});
 }
 const hero=(await readFile(path.join(root,'marketing/assets/mail-hero-v3.webp'))).toString('base64');
 await page.setViewportSize({width:1200,height:630});
 await page.setContent(`<style>@font-face{font-family:Sora;src:url(data:font/woff2;base64,${font});font-weight:100 900}*{box-sizing:border-box}body{margin:0;background:#07101d;color:#f5f8ff;font-family:Sora,sans-serif;width:1200px;height:630px;overflow:hidden}article{position:relative;width:100%;height:100%;padding:56px 60px}article:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#07101d 36%,#07101d00 83%);z-index:-1}.art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.brand{width:285px;height:52px}.headline{font-size:61px;line-height:1.17;letter-spacing:-3px;font-weight:500;margin:78px 0 24px;max-width:760px}p{font-size:20px;color:#a7c8ff;line-height:1.7;margin:0}.bottom{position:absolute;bottom:45px;left:60px;color:#a4b3c9;font-size:14px}</style><article><img class="art" src="data:image/webp;base64,${hero}"><img class="brand" src="data:image/svg+xml;base64,${Buffer.from(wordmark('#f5f8ff')).toString('base64')}"><h1 class="headline">Good emails.<br>Better connections.</h1><p>Campaigns, workflows, and real conversations.<br>One workspace for every email.</p><span class="bottom">sendmailos.com</span></article>`);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
 await page.screenshot({path:path.join(folder,'sendmailos-social-1200x630.png')});
 await writeFile(path.join(folder,'brand.json'),JSON.stringify({source:'https://dash.sendmailos.com/favicon.ico',reference:'dashboard-favicon-reference.png',method:'Native SVG wordmark extending the existing paper-plane identity; PNG and social derivatives rendered in Chromium.',indigo,font:'Sora (SIL Open Font License; see ../fonts/Sora-OFL.txt)',files:['sendmailos-logo-preview.png','sendmailos-mark.svg','sendmailos-wordmark-dark.svg','sendmailos-wordmark-light.svg','sendmailos-wordmark-dark.png','sendmailos-wordmark-light.png','sendmailos-icon-64.png','sendmailos-icon-180.png','sendmailos-icon-512.png','sendmailos-social-1200x630.png']},null,2)+'\n');
 const manifest=JSON.parse(await readFile(path.join(folder,'brand.json'),'utf8')),entries={};
 for(const file of [...manifest.files,'README.md','brand.json'])entries[file]=new Uint8Array(await readFile(path.join(folder,file)));
 entries['Sora-OFL.txt']=new Uint8Array(await readFile(path.join(root,'marketing/assets/fonts/Sora-OFL.txt')));
 await writeFile(path.join(folder,'sendmailos-logo-pack.zip'),zipSync(entries,{level:6}));
 console.log(JSON.stringify({palette:indigo,generated:10,directory:'marketing/assets/brand',logoPack:'marketing/assets/brand/sendmailos-logo-pack.zip'}));
}finally{await browser.close();}
