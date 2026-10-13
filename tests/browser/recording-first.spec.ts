import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {practiceClip} from '../practice-fixtures';
import {phoneVideo} from './phone-fixture';
import {irregularVideo} from './irregular-fixture';
const reference=practiceClip();
async function open(page:Page){await page.goto('/');await page.getByRole('button',{name:'Practice Mode',exact:true}).click();await page.getByLabel('Practice language').selectOption('en');await page.getByLabel('Load reference MotionClip JSON',{exact:true}).setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reference))});}
async function worker(context:BrowserContext,delay=0,hands=true){await context.route('**/detector.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`const frames=${JSON.stringify(reference.frames)};self.onmessage=e=>{if(e.data.type==='init'){self.postMessage({type:'ready'});return;}setTimeout(()=>{const f=structuredClone(frames[Math.min(30,Math.floor(e.data.timestampMs/66))]);f.timestamp=e.data.timestampMs;if(!${hands}){f.hands=[];f.assignment={};}e.data.frame.close();self.postMessage({type:'result',result:f});},${delay});};`}));}
const quality=(page:Page)=>page.getByLabel('Recording and analysis measurements');
const observationCount=async(page:Page)=>Number((await quality(page).innerText()).match(/Distinct observations: (\d+)\//)![1]);
test('recorded 30 Hz canvas video is retained despite 6.6 FPS synthetic inference',async({page,context})=>{
  test.setTimeout(90000);await worker(context,150);
  await page.addInitScript(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d')!;let frame=0;
    const draw=()=>{c.fillStyle='#99c';c.fillRect(0,0,320,240);c.fillStyle=`rgb(${frame++%255},50,100)`;c.fillRect(0,0,60,60);};draw();
    const timer=setInterval(draw,1000/30),stream=canvas.captureStream(30);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}return stream;
  }}));
  let requestedModel=false;page.on('request',r=>{if(r.url().includes('detector.worker'))requestedModel=true;});
  await open(page);await page.getByRole('button',{name:'Enable camera',exact:true}).click();await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();
  await expect(page.getByText(/Recording locally.*preview observations/)).toContainText(/(?:3[0-9]|[4-9][0-9]) preview observations/);
  expect(requestedModel).toBe(false);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:45000});expect(requestedModel).toBe(true);
  expect(await observationCount(page)).toBeGreaterThan(20);await expect(quality(page)).toContainText(/Inference throughput: 6\.[0-9] FPS/);await expect(quality(page)).toContainText('Encoded recording FPS: unavailable');
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Save original recording',exact:true}).click();await(await download).saveAs('work/recording-first-synthetic.webm');
  await writeFile('work/recording-first-measurements.txt',await quality(page).innerText());
});
test('30 Hz analysis of 15 FPS encoded video does not invent duplicate evidence',async({page,context})=>{
  await worker(context);await open(page);await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'15fps.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible();expect(await observationCount(page)).toBe(15);
  await expect(quality(page)).toContainText('Offline sampling request: 30 Hz');await expect(quality(page)).toContainText('decoded-presentation-time');
});
test('VFR gaps retain their timestamps instead of fabricating missing handshapes',async({page,context})=>{
  await worker(context);await open(page);await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'irregular.mp4',mimeType:'video/mp4',buffer:irregularVideo});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible();expect(await observationCount(page)).toBe(48);
  await expect(quality(page)).toContainText(/Duplicate \/ unconfirmed timestamp \/ irregular interval: 12 \/ 0 \/ 1/);
});
test('Android user-agent keeps worker extraction and offers independent 15 Hz sampling',async({page,context})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130 Mobile Safari/537.36'}));
  await worker(context);await open(page);await page.getByLabel('Offline analysis sampling').selectOption('15');await page.getByLabel('Analysis maximum dimension').selectOption('640');
  await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'android-fixture.mp4',mimeType:'video/mp4',buffer:phoneVideo});await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible();
  await expect(quality(page)).toContainText('Offline sampling request: 15 Hz · 640 px');expect(await observationCount(page)).toBe(15);
});
test('missing fingers retain position metrics and quality diagnostics fit a mobile viewport',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await worker(context,0,false);await open(page);
  await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'wrist-only.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible();
  await expect(page.locator('.practice-metrics article').filter({has:page.getByRole('heading',{name:'Finger articulation',exact:true})}).first()).toContainText('Insufficient tracking');
  await expect(page.locator('.practice-metrics article').filter({has:page.getByRole('heading',{name:'Hand / shoulder position',exact:true})}).first()).toContainText('body units');
  await expect(page.getByLabel('Tracking diagnostics')).toContainText('50%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('failed analysis retains original file for download and reanalysis',async({page,context})=>{
  await context.route('**/detector.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:"self.onmessage=()=>self.postMessage({type:'error',message:'Synthetic initialization failure'});"}));
  await open(page);await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'preserved.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByRole('alert')).toContainText('Model initialization failure');await expect(page.getByRole('link',{name:'Save original recording',exact:true})).toBeVisible();
  await context.unroute('**/detector.worker-*.js');await worker(context);await page.getByRole('button',{name:'Analyze saved recording again',exact:true}).click();await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible();
  await page.getByText('Load a local learner MotionClip (optional)',{exact:true}).click();
  await page.getByLabel('Load a local learner MotionClip (optional)',{exact:true}).setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reference))});
  await expect(page.getByRole('link',{name:'Save original recording',exact:true})).toHaveCount(0);await expect(quality(page)).toHaveCount(0);
});
test('real MediaPipe resolution and offline sampling benchmark (public photo, not signing)',async({page,context})=>{
  test.skip(!process.env.PRACTICE_BENCHMARK,'Opt-in exact local model bytes and 30 FPS photo video required.');test.setTimeout(240000);
  await context.route('https://storage.googleapis.com/mediapipe-models/**',async route=>route.fulfill({body:await readFile(join('work',route.request().url().includes('pose_landmarker')?'pose_landmarker_full.task':'hand_landmarker.task')),contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}}));
  await context.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm/**',async route=>{const name=basename(new URL(route.request().url()).pathname);await route.fulfill({body:await readFile(join('node_modules/@mediapipe/tasks-vision/wasm',name)),contentType:name.endsWith('.wasm')?'application/wasm':'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});});
  const reports:string[]=[];
  for(const [hz,dimension] of [[30,960],[30,640],[15,960]]){
    await open(page);await page.getByLabel('Offline analysis sampling').selectOption(String(hz));await page.getByLabel('Analysis maximum dimension').selectOption(String(dimension));
    await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles('work/public-photo-30fps.mp4');
    await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:90000});
    expect(await observationCount(page)).toBe(hz*2);reports.push((await quality(page).innerText())+'\n'+await page.getByLabel('Tracking diagnostics').innerText());
  }
  await writeFile('work/offline-inference-benchmark.txt',reports.join('\n\n'));
});
