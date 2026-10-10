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
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
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
