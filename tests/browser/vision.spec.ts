import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join,basename } from 'node:path';
import { importMotion } from '../../src/motion/serialization';
test('actual MediaPipe inference on uploaded video and video-clock synchronization',async({page,context})=>{
  test.skip(!process.env.VISION_TEST_VIDEO,'Opt-in: provide a real local test video and downloaded model assets.');
  test.setTimeout(180000);
  // Serve exact upstream bytes locally in restricted CI; never fake inference results.
  await context.route('https://storage.googleapis.com/mediapipe-models/**',async route=>{
    const name=route.request().url().includes('pose_landmarker')?'pose_landmarker_full.task':'hand_landmarker.task';
    await route.fulfill({body:await readFile(join('work',name)),contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await context.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm/**',async route=>{
    const name=basename(new URL(route.request().url()).pathname);
    await route.fulfill({body:await readFile(join('node_modules/@mediapipe/tasks-vision/wasm',name)),contentType:name.endsWith('.wasm')?'application/wasm':'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('input[accept="video/mp4,video/webm,.mp4,.webm"]').setInputFiles(process.env.VISION_TEST_VIDEO!);
  if(process.env.VISION_MIRRORED==='1')await page.getByLabel('Mirrored source').check();
  await page.getByLabel('Frame sampling').selectOption('15');
  await expect(page.getByRole('button',{name:'Extract & reconstruct'})).toBeEnabled();
  await page.getByRole('button',{name:'Extract & reconstruct'}).click();
  await expect.poll(async()=>await page.getByText('EXTRACTED MOTION',{exact:true}).isVisible()||await page.getByRole('alert').isVisible(),{timeout:150000}).toBe(true);
  if(await page.getByRole('alert').isVisible())throw new Error(await page.getByRole('alert').innerText());
  await expect(page.getByText('EXTRACTED MOTION',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const exported=await download;await exported.saveAs('work/vision-result.motion.json');
  const motion=importMotion(await readFile('work/vision-result.motion.json','utf8'));
  expect(motion.source.mirrored).toBe(process.env.VISION_MIRRORED==='1');
  expect(motion.frames.length).toBeGreaterThan(5);expect(motion.frames.some(f=>f.bodyWorld.length===33)).toBe(true);expect(motion.frames.some(f=>f.pose.quality.body>0)).toBe(true);
  if(process.env.VISION_EXPECT_HANDS==='1')for(const side of ['left','right'] as const)expect(motion.frames.some(f=>f.pose.quality[`${side}State`]==='tracked')).toBe(true);
  expect(motion.frames.at(-1)!.timestamp).toBeGreaterThan(0);
  // Scrub, pause and slow playback must all use the displayed video's clock.
  await page.getByLabel('Seek timeline').fill('0.4');await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeCloseTo(.4,2);
  await expect(page.getByText('Frame 7 / '+motion.frames.length,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'0.5×',exact:true}).click();await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.45);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const current=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime);expect(Number(await page.getByLabel('Seek timeline').inputValue())).toBeCloseTo(current,2);
  await page.screenshot({path:'work/processed-video.png',fullPage:true});expect(errors).toEqual([]);
});
test('cancellation during model initialization releases the UI',async({page,context})=>{
  test.skip(!process.env.VISION_TEST_VIDEO,'Opt-in local video fixture required.');
  await context.route('https://cdn.jsdelivr.net/**',()=>new Promise(()=>{}));
  await page.goto('/');await page.locator('input[accept="video/mp4,video/webm,.mp4,.webm"]').setInputFiles(process.env.VISION_TEST_VIDEO!);
  await page.getByRole('button',{name:'Extract & reconstruct'}).click();await expect(page.getByText('Loading pose & hand models',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel processing'}).click();await expect(page.getByRole('alert')).toContainText('Processing canceled');
  await expect(page.getByRole('button',{name:'Extract & reconstruct'})).toBeEnabled();
  await expect(page.getByText('Rest pose · no motion loaded')).toBeVisible();
});
