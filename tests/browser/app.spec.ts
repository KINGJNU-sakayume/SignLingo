import { test,expect } from '@playwright/test';
import { fixtureClip } from '../fixtures';
test('upload-first UI, real rig and mobile layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByRole('heading',{name:'수어 동작을 3D로 재현합니다.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'동작 추출 및 복원'})).toBeDisabled();
  await expect(page.getByText('기본 자세 · 동작을 불러오지 않았습니다')).toBeVisible();
  await expect(page.locator('.avatar-stage canvas')).toBeVisible();
  await page.getByRole('button',{name:'측면',exact:true}).click();await page.getByLabel('뼈대 표시', {exact:true}).check();
  await page.screenshot({path:'work/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'영상 선택'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'The page must fit after responsive canvas/layout resize'}).toBeLessThanOrEqual(0);
  await page.screenshot({path:'work/mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('motion import, scrubbing, correction and export preserve source data',async({page})=>{
  await page.goto('/');const clip=fixtureClip();await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'synthetic.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await expect(page.getByText('동작만 재생 중')).toBeVisible();
  await expect(page.getByText('합성 테스트',{exact:true})).toBeVisible();
  await page.getByLabel('재생 위치').fill('0.1');await expect(page.getByText('프레임 2 / 3',{exact:true})).toBeVisible();
  await page.locator('summary').click();await page.getByLabel('굽힘 correction',{exact:true}).fill('20');await page.getByRole('button',{name:'현재 프레임 보정 저장'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 내보내기'}).click();const file=await download;const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);const exported=JSON.parse(Buffer.concat(chunks).toString());expect(exported.edits).toEqual([{frame:1,side:'left',degrees:[20,0,0]}]);expect(exported.frames).toEqual(clip.frames);
  await page.getByRole('button',{name:'재생',exact:true}).click();await expect(page.getByRole('button',{name:'일시정지',exact:true})).toBeVisible();await page.getByRole('button',{name:'일시정지',exact:true}).click();
});
test('invalid imported data fails visibly',async({page})=>{
  await page.goto('/');await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"fake"}')});await expect(page.getByRole('alert')).toContainText('불러오기 실패');await expect(page.getByText('기본 자세 · 동작을 불러오지 않았습니다')).toBeVisible();
});
test('technical laboratory compares stored detections, seeks exact frames and exports proxies',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');const clip=fixtureClip();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({name:'analytic.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await page.getByLabel('기술 진단 모드').check();
  const lab=page.getByRole('region',{name:'복원 기술 진단'});await expect(lab).toBeVisible();
  await page.getByLabel('복원 방식 선택').selectOption('improved');
  await expect(lab).toContainText('양쪽 방향 비교 표본: 90');
  await page.getByRole('button',{name:'다음 프레임',exact:true}).click();await expect(lab).toContainText('검사 중인 프레임 2 / 3');
  await expect(page.getByLabel('재생 위치')).toHaveValue('0.1');
  await page.getByLabel('검사할 관절').selectOption('right.thumb.0');
  await expect(page.getByRole('img',{name:'right.thumb.0 관절 각도 변화: 굽힘 녹색, 벌림 주황색'})).toBeVisible();
  await expect(lab).toContainText('detectedDirection:');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'비교 요약 내보내기'}).click();const stream=await(await download).createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);const summary=JSON.parse(Buffer.concat(chunks).toString());
  expect(summary.paired.segments).toBe(90);expect(summary.improved.directionMeanDegrees).toBeLessThan(.00001);expect(summary.linguisticReview).toBe('not performed');expect(summary).not.toHaveProperty('frames');
  await page.screenshot({path:'work/diagnostics-lab.png',fullPage:true});
  // Reproduce the CI overflow with a wider Linux font fallback.
  await page.addStyleTag({content:':root{font-family: "DejaVu Sans", sans-serif}'});
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'The page must fit after responsive canvas/layout resize'}).toBeLessThanOrEqual(0);
  await page.getByRole('button',{name:'선택한 복원 결과 적용'}).click();
  await page.getByLabel('기술 진단 모드').uncheck();
  await expect(page.getByText('손목 직접 보정',{exact:false})).toBeVisible();
  const motionDownload=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 내보내기',exact:true}).click();const motionStream=await(await motionDownload).createReadStream();const motionChunks:Buffer[]=[];for await(const chunk of motionStream!)motionChunks.push(chunk);const adopted=JSON.parse(Buffer.concat(motionChunks).toString());expect(adopted.pipeline.version).toBe('0.2.0');expect(adopted.frames[0].hands).toEqual(clip.frames[0].hands);
  expect(errors).toEqual([]);
});
