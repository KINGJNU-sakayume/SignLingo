import { test,expect } from '@playwright/test';
import { fixtureClip } from '../fixtures';
test('upload-first UI, real rig and mobile layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByRole('heading',{name:'From movement to motion.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Extract & reconstruct'})).toBeDisabled();
  await expect(page.getByText('Rest pose · no motion loaded')).toBeVisible();
  await expect(page.locator('.avatar-stage canvas')).toBeVisible();
  await page.getByRole('button',{name:'side',exact:true}).click();await page.getByLabel('Skeleton', {exact:true}).check();
  await page.screenshot({path:'work/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Choose video'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'The page must fit after responsive canvas/layout resize'}).toBeLessThanOrEqual(0);
  await page.screenshot({path:'work/mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('motion import, scrubbing, correction and export preserve source data',async({page})=>{
  await page.goto('/');const clip=fixtureClip();await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'synthetic.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await expect(page.getByText('Motion-only playback')).toBeVisible();
  await expect(page.getByText('SYNTHETIC TEST',{exact:true})).toBeVisible();
  await page.getByLabel('Seek timeline').fill('0.1');await expect(page.getByText('Frame 2 / 3',{exact:true})).toBeVisible();
  await page.locator('summary').click();await page.getByLabel('Flexion correction',{exact:true}).fill('20');await page.getByRole('button',{name:'Save frame correction'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const file=await download;const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);const exported=JSON.parse(Buffer.concat(chunks).toString());expect(exported.edits).toEqual([{frame:1,side:'left',degrees:[20,0,0]}]);expect(exported.frames).toEqual(clip.frames);
  await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
});
test('invalid imported data fails visibly',async({page})=>{
  await page.goto('/');await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"fake"}')});await expect(page.getByRole('alert')).toContainText('Import rejected');await expect(page.getByText('Rest pose · no motion loaded')).toBeVisible();
});
test('technical laboratory compares stored detections, seeks exact frames and exports proxies',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');const clip=fixtureClip();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'analytic.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await page.getByLabel('Technical inspection mode').check();
  const lab=page.getByRole('region',{name:'Reconstruction diagnostics laboratory'});await expect(lab).toBeVisible();
  await page.getByLabel('Inspect pipeline').selectOption('improved');
  await expect(lab).toContainText('paired direction samples: 90');
  await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(lab).toContainText('Inspection frame 2 / 3');
  await expect(page.getByLabel('Seek timeline')).toHaveValue('0.1');
  await page.getByLabel('Inspection joint').selectOption('right.thumb.0');
  await expect(page.getByRole('img',{name:'right.thumb.0 joint angle timeline: flexion green, spread gold'})).toBeVisible();
  await expect(lab).toContainText('detectedDirection:');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export proxy summary'}).click();const stream=await(await download).createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);const summary=JSON.parse(Buffer.concat(chunks).toString());
  expect(summary.paired.segments).toBe(90);expect(summary.improved.directionMeanDegrees).toBeLessThan(.00001);expect(summary.linguisticReview).toBe('not performed');expect(summary).not.toHaveProperty('frames');
  await page.screenshot({path:'work/diagnostics-lab.png',fullPage:true});
  // Reproduce the CI overflow with a wider Linux font fallback.
  await page.addStyleTag({content:':root{font-family: "DejaVu Sans", sans-serif}'});
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'The page must fit after responsive canvas/layout resize'}).toBeLessThanOrEqual(0);
  await page.getByRole('button',{name:'Use selected reconstruction'}).click();
  await page.getByLabel('Technical inspection mode').uncheck();
  await expect(page.getByText('Manual wrist correction',{exact:false})).toBeVisible();
  const motionDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON',exact:true}).click();const motionStream=await(await motionDownload).createReadStream();const motionChunks:Buffer[]=[];for await(const chunk of motionStream!)motionChunks.push(chunk);const adopted=JSON.parse(Buffer.concat(motionChunks).toString());expect(adopted.pipeline.version).toBe('0.2.0');expect(adopted.frames[0].hands).toEqual(clip.frames[0].hands);
  expect(errors).toEqual([]);
});
