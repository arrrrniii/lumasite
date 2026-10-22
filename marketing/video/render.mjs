#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const assets=path.resolve(here,'../assets');
const ffmpeg=process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg';
const output=path.join(assets,'mail-signals-hero.mp4');
const framesDir=path.join(here,'frames');
await mkdir(assets,{recursive:true});
await mkdir(framesDir,{recursive:true});
const browser=await chromium.launch({headless:true});
let encoder;
let stderr='';
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 await page.goto(new URL('./scene.html',import.meta.url).href,{waitUntil:'load'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await writeFile(path.join(assets,'mail-signals-hero-poster.png'),Buffer.from(await page.evaluate(()=>window.exportFrame(72)),'base64'));
 encoder=spawn(ffmpeg,['-y','-f','image2pipe','-framerate','30','-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-r','30',output],{stdio:['pipe','ignore','pipe']});
 encoder.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>20000)stderr=stderr.slice(-20000);});
 const finished=new Promise((resolve,reject)=>{encoder.once('error',reject);encoder.once('close',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}: ${stderr}`)));});
 for(let frame=0;frame<360;frame++){
  const base64=await page.evaluate(frame=>window.exportFrame(frame),frame);
  if(!encoder.stdin.write(Buffer.from(base64,'base64')))await once(encoder.stdin,'drain');
  if(frame%60===0)console.log(`Rendered ${frame}/360 frames`);
 }
 encoder.stdin.end();await finished;
 if(errors.length)throw new Error(errors.join('\n'));
 await writeFile(path.join(assets,'mail-signals-hero-poster.png'),Buffer.from(await page.evaluate(()=>window.exportFrame(72)),'base64'));
 for(const frame of [0,90,180,270,359,360])await writeFile(path.join(framesDir,`frame-${String(frame).padStart(3,'0')}.png`),Buffer.from(await page.evaluate(frame=>window.exportFrame(frame),frame),'base64'));
 await writeFile(path.join(assets,'mail-signals-hero-provenance.json'),JSON.stringify({name:'SendMailOS mail signals hero',kind:'Original deterministic Canvas motion graphics',source:'marketing/video/scene.html',renderer:'marketing/video/render.mjs',dimensions:{width:1280,height:720},durationSeconds:12,frameRate:30,frames:360,loop:'All motion parameterized by a twelve-second period; frame360 is identical to frame0.',encoding:{codec:'H.264',pixelFormat:'yuv420p',audio:false,crf:19,preset:'slow',faststart:true},palette:['#07101d','#4f8cff','#a7c8ff'],description:'Symbolic email packets and binary light signals move along cubic routing curves through an API gateway into illustrative delivered message cards. The left44percent is quiet for the website headline.',realNetworkRequests:false,externalAssets:[],generatedWithAIImageOrVideoService:false},null,2)+'\n');
 console.log(`Saved ${output}`);
}finally{
 if(encoder&&encoder.exitCode===null)encoder.kill('SIGTERM');
 await browser.close();
}
