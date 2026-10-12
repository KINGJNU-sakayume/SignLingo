import { test,expect,type Page,type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename,join } from 'node:path';
import { practiceClip } from '../practice-fixtures';
const reference=practiceClip();
async function openPractice(page:Page) {
  await page.goto('/');await page.getByRole('button',{name:'Practice Mode',exact:true}).click();
  await page.getByLabel('Practice language').selectOption('en');
  await page.getByLabel('Load reference MotionClip JSON',{exact:true}).setInputFiles({name:'synthetic-reference.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(reference))});
}
async function syntheticCamera(page:Page,photo=false) {
  // Browser lifecycle fixture, not camera permission or tracking accuracy evidence.
  await page.addInitScript(({photo})=>{
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d')!;
      let img:HTMLImageElement|undefined;
      if(photo){img=new Image();img.src='/practice-photo.jpg';await img.decode();canvas.height=Math.round(640*img.height/img.width);}
      const draw=()=>{ctx.fillStyle='#abc';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,canvas.width/2,canvas.height);ctx.fillStyle='#0000ff';ctx.fillRect(canvas.width/2,0,canvas.width/2,canvas.height);if(img)ctx.drawImage(img,0,0,canvas.width,canvas.height);};draw();
      const timer=setInterval(draw,66),stream=canvas.captureStream(15);
      const tracks=stream.getTracks();for(const track of tracks){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
      (window as unknown as {practiceTracks:MediaStreamTrack[]}).practiceTracks=tracks;
      return stream;
    }});
  },{photo});
}
const stopped=(page:Page)=>page.evaluate(()=>(window as unknown as {practiceTracks:MediaStreamTrack[]}).practiceTracks.every(t=>t.readyState==='ended'));
test('reference playback, DTW inspection, localized feedback, trimming, retries and mobile layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openPractice(page);
  await page.getByRole('button',{name:'Play comparison',exact:true}).click();await expect(page.getByRole('button',{name:'Pause comparison',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause comparison',exact:true}).click();
  const learner=practiceClip();learner.frames.forEach(f=>{f.bodyWorld[15].y+=.25;});
  await page.getByText('Load a local learner MotionClip (optional)',{exact:true}).click();
  await page.getByLabel('Load a local learner MotionClip (optional)',{exact:true}).setInputFiles({name:'synthetic-learner.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(learner))});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByRole('img',{name:'Temporal alignment',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Left hand is observed lower/}).click();
  await expect(page.getByLabel('Path hand')).toHaveValue('left');
  await page.getByLabel('Reference Start (seconds)',{exact:true}).fill('.3');await page.getByLabel('Aligned frame',{exact:true}).fill('3');
  await page.screenshot({path:'work/practice-desktop.png',fullPage:true});
  await page.getByLabel('Practice language').selectOption('ko');await expect(page.getByRole('heading',{name:'항목별 움직임 차이',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);await page.screenshot({path:'work/practice-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'다시 연습',exact:true}).click();await expect(page.getByRole('heading',{name:'항목별 움직임 차이',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'카메라 켜기',exact:true})).toBeEnabled();expect(errors).toEqual([]);
});
test('permission denial is actionable and does not disable retry',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}));
  await openPractice(page);await page.getByRole('button',{name:'Enable camera',exact:true}).click();await expect(page.getByRole('alert')).toContainText('permission was denied');await expect(page.getByRole('button',{name:'Enable camera',exact:true})).toBeEnabled();
});
test('local recording countdown, extraction, camera cleanup and mode exit (synthetic detector)',async({page,context})=>{
  test.setTimeout(60000);await syntheticCamera(page);
  await context.route('**/detector.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`const frames=${JSON.stringify(reference.frames)};self.onmessage=e=>{if(e.data.type==='init')self.postMessage({type:'ready'});else{const canvas=new OffscreenCanvas(e.data.frame.width,e.data.frame.height);const ctx=canvas.getContext('2d');ctx.drawImage(e.data.frame,0,0);const pixel=ctx.getImageData(2,2,1,1).data;if(pixel[2]<200||pixel[0]>20){e.data.frame.close();self.postMessage({type:'error',message:'Synthetic pixel-unmirroring regression: expected blue on the left'});return;}const frame=structuredClone(frames[Math.min(frames.length-1,Math.floor(e.data.timestampMs/66))]);frame.timestamp=e.data.timestampMs;e.data.frame.close();self.postMessage({type:'result',result:frame});}};`}));
  const uploads:string[]=[];page.on('request',r=>{if(r.method()==='POST')uploads.push(r.url());});await openPractice(page);
  await page.getByLabel('Mirror camera preview',{exact:true}).uncheck();await page.getByLabel('Actual camera pixels are mirrored (unmirror before tracking)',{exact:true}).check();
  await page.getByRole('button',{name:'Enable camera',exact:true}).click();await expect(page.getByRole('button',{name:'Start 3-second countdown',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();await expect(page.getByRole('status')).toHaveText('3');
  await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();await expect(page.getByText(/Recording locally.*captured frames/)).toContainText(/(?:[5-9]|[1-9][0-9]+) captured frames/);
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:15000});expect(await stopped(page)).toBe(true);await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'Enable camera',exact:true}).click();await expect(page.getByRole('button',{name:'Start 3-second countdown',exact:true})).toBeVisible();await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();
  await page.getByRole('button',{name:'Motion Lab',exact:true}).click();expect(await stopped(page)).toBe(true);await expect(page.getByRole('heading',{name:'From movement to motion.',exact:true})).toBeVisible();expect(uploads).toEqual([]);
});
test('real MediaPipe extracts a local webcam-style stream (public still photo, not KSL)',async({page,context})=>{
  test.skip(!process.env.PRACTICE_VISION_TEST,'Opt-in: requires downloaded MediaPipe assets and public still-photo fixture in work/.');test.setTimeout(180000);
  await context.route('**/practice-photo.jpg',async route=>route.fulfill({body:await readFile('work/male_full_height_hands.jpg'),contentType:'image/jpeg'}));
  await context.route('https://storage.googleapis.com/mediapipe-models/**',async route=>route.fulfill({body:await readFile(join('work',route.request().url().includes('pose_landmarker')?'pose_landmarker_full.task':'hand_landmarker.task')),contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}}));
  await context.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm/**',async route=>{const name=basename(new URL(route.request().url()).pathname);await route.fulfill({body:await readFile(join('node_modules/@mediapipe/tasks-vision/wasm',name)),contentType:name.endsWith('.wasm')?'application/wasm':'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});});
  await syntheticCamera(page,true);await openPractice(page);await page.getByRole('button',{name:'Enable camera',exact:true}).click();
  await expect(page.getByRole('button',{name:'Start 3-second countdown',exact:true})).toBeVisible({timeout:120000});await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();
  await expect(page.getByText(/Recording locally.*captured frames/)).toContainText(/(?:[5-9]|[1-9][0-9]+) captured frames/,{timeout:30000});await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:50000});await expect(page.getByRole('alert')).toHaveCount(0);expect(await stopped(page)).toBe(true);
});

import { phoneVideo } from './phone-fixture';
async function mockWorker(context:BrowserContext,mode='ok') {
  await context.route('**/detector.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`const frames=${JSON.stringify(reference.frames)};self.onmessage=e=>{if(e.data.type==='init'){self.postMessage(${mode==='init-fail'?"{type:'error',message:'model download failed'}":"{type:'ready'}"});return;}e.data.frame.close();const frame=structuredClone(frames[Math.min(30,Math.floor(e.data.timestampMs/66))]);frame.timestamp=e.data.timestampMs;${mode==='empty'?"frame.hands=[];":""}self.postMessage(${mode==='inference-fail'?"{type:'error',message:'synthetic inference failure'}":"{type:'result',result:frame}"});};`}));
}
test('native-phone video fallback preserves reference comparison without camera or MediaRecorder',async({page,context})=>{
  await mockWorker(context);await page.addInitScript(()=>{
    Object.defineProperty(window,'MediaRecorder',{value:undefined});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{throw new Error('Fallback must not request webcam');}});
  });
  await openPractice(page);await page.setViewportSize({width:390,height:844});
  const input=page.getByLabel('Record or choose a phone video',{exact:true});await expect(input).toHaveAttribute('capture','user');
  const uploads:string[]=[];page.on('request',r=>{if(r.method()==='POST')uploads.push(r.url());});
  await input.setInputFiles({name:'phone.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:15000});await expect(page.getByRole('alert')).toHaveCount(0);expect(uploads).toEqual([]);
  await expect(page.getByText(reference.source.name,{exact:true})).toBeVisible();
});

for(const [mode,message] of [['init-fail','Model initialization failure'],['inference-fail','Inference failure'],['empty','tracking is insufficient']] as const){
  test(`mobile fallback reports ${mode} without a misleading comparison`,async({page,context})=>{
    await mockWorker(context,mode);await openPractice(page);
    await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'phone.mp4',mimeType:'video/mp4',buffer:phoneVideo});
    await expect(page.getByRole('alert')).toContainText(message,{timeout:15000});await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Enable camera',exact:true})).toBeEnabled();
  });
}
test('live diagnostics and overlay survive mirroring; mute invalidates the attempt',async({page,context})=>{
  await syntheticCamera(page);await mockWorker(context);await openPractice(page);
  await page.getByRole('button',{name:'Enable camera',exact:true}).click();await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();
  const status=page.getByLabel('Live tracking diagnostics');await expect(status).toContainText('Left hand: tracked');await expect(status).toContainText('Valid feature coverage: 100%');
  await expect(page.locator('.practice-camera .landmarks')).toBeVisible();await expect(status).toContainText(/Processed FPS: [1-9]/);
  await page.evaluate(()=>(window as unknown as {practiceTracks:MediaStreamTrack[]}).practiceTracks[0].dispatchEvent(new Event('mute')));
  await expect(page.getByRole('alert')).toContainText('interrupted');expect(await stopped(page)).toBe(true);await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toHaveCount(0);
});
test('backgrounding a recording explains discarded capture and releases resources',async({page,context})=>{
  await syntheticCamera(page);await mockWorker(context);await openPractice(page);await page.getByRole('button',{name:'Enable camera',exact:true}).click();await page.getByRole('button',{name:'Start 3-second countdown',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('alert')).toContainText('page was hidden');expect(await stopped(page)).toBe(true);
});
test('iOS-selected main-thread Canvas inference and phone fallback without ImageBitmap',async({page,context})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone) CriOS/130'});Object.defineProperty(window,'createImageBitmap',{value:undefined});
    Object.defineProperty(window,'Worker',{value:class{constructor(){throw new Error('iOS must not instantiate worker');}}});
  });
  // Mock the Tasks API, not the app detector, to exercise its real initialization,
  // Canvas input, confidence cleanup, timestamps and main-thread lifecycle.
  await context.route('**/vision_bundle-*.js',route=>route.fulfill({contentType:'text/javascript',body:`
    const f=${JSON.stringify(reference.frames[0])};
    export const FilesetResolver={forVisionTasks:async()=>({wasmLoaderPath:'data:text/javascript,export default function(){}'})};
    function check(input){if(!(input instanceof HTMLCanvasElement))throw new Error('Expected Canvas');const p=input.getContext('2d').getImageData(2,2,1,1).data;if(p[2]<150||p[0]>60)throw new Error('Mirrored phone pixels were not restored');}
    export const PoseLandmarker={createFromOptions:async()=>({close(){},detectForVideo(input,t){check(input);return {landmarks:[f.body],worldLandmarks:[f.bodyWorld]};}})};
    export const HandLandmarker={createFromOptions:async()=>({close(){},detectForVideo(input,t){check(input);return {landmarks:f.hands.map(h=>h.image),worldLandmarks:f.hands.map(h=>h.world),handedness:f.hands.map(h=>[{categoryName:h.label,score:h.score}])};}})};
  `}));
  await openPractice(page);await page.getByLabel('Actual camera pixels are mirrored (unmirror before tracking)',{exact:true}).check();
  await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'phone.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toBeVisible({timeout:15000});await expect(page.getByRole('alert')).toHaveCount(0);
});
test('canceling fallback during initialization cannot publish a stale result',async({page,context})=>{
  await context.route('**/detector.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{};'}));await openPractice(page);
  await page.getByLabel('Record or choose a phone video',{exact:true}).setInputFiles({name:'phone.mp4',mimeType:'video/mp4',buffer:phoneVideo});
  await expect(page.getByText('Loading pose & hand models',{exact:true})).toBeVisible();await page.getByRole('button',{name:'End camera session',exact:true}).click();
  await expect(page.getByLabel('Record or choose a phone video',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Component differences',exact:true})).toHaveCount(0);
});
