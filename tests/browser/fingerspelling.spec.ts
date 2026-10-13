import {test,expect} from '@playwright/test';
test('fingerspelling photos are usable, credited and locally tracked without inventing motion data',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Simulate only external image transport; the lesson metadata is the actual
  // Commons source collection, and no synthetic content is published.
  await page.route('https://commons.wikimedia.org/wiki/Special:FilePath/**',route=>route.fulfill({
    status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAJ5blgAAAABJRU5ErkJggg==','base64')
  }));
  await page.goto('/');
  await page.getByRole('button',{name:'공개 자료로 지문자 학습 시작 · 32개'}).click();
  await expect(page.getByRole('region',{name:'한글 지문자 사진 학습'})).toBeVisible();
  await expect(page.getByRole('img',{name:'한국수어 지문자 ㄱ의 손 모양 사진'})).toBeVisible();
  await expect(page.getByRole('link',{name:'사진 원본 · 개별 라이선스 정보 ↗'})).toHaveAttribute('href',/commons.wikimedia.org\/wiki\/File:KSL_g.jpg/);
  await page.getByRole('button',{name:'사진 관찰 완료'}).click();
  await expect(page.getByRole('button',{name:'관찰 기록 취소'})).toBeVisible();
  await page.getByRole('button',{name:'다음 →'}).click();
  await expect(page.getByRole('img',{name:'한국수어 지문자 ㄴ의 손 모양 사진'})).toBeVisible();
  await page.getByRole('button',{name:'모음',exact:true}).click();
  await expect(page.getByRole('img',{name:'한국수어 지문자 ㅏ의 손 모양 사진'})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'공개 자료로 지문자 학습 시작 · 32개'}).click();
  await expect(page.getByText('사진 관찰 완료',{exact:true}).first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('open handshape lesson fits a 390 px phone and does not claim automatic scoring',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'공개 자료로 지문자 학습 시작 · 32개'}).click();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.getByText('영상 또는 자동 수어 채점 자료가 아닙니다.',{exact:false})).toBeVisible();
});