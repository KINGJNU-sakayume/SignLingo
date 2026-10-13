import { test,expect } from '@playwright/test';
import { practiceClip } from '../practice-fixtures';

test('first lesson connects a real MotionClip interface to Practice without declaring KSL correctness',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await page.getByRole('button',{name:'학습하기'}).click();
  await expect(page.getByRole('heading',{name:'나의 첫 수어 표현'})).toBeVisible();
  await expect(page.getByText('허위 수어 동작이나 임의의 정답 애니메이션은 제공하지 않습니다.',{exact:false})).toBeVisible();
  await page.getByLabel('레슨 기준 동작 JSON').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"no"}')});
  await expect(page.getByRole('alert')).toContainText('불러오지 못했습니다');
  const clip=practiceClip();
  await page.getByLabel('레슨 기준 동작 JSON').setInputFiles({name:'sign-reference.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await expect(page.getByText('연결된 자료:',{exact:false})).toBeVisible();
  await expect(page.locator('.lesson-reference canvas')).toBeVisible();
  await page.getByRole('button',{name:'시범 확인 완료'}).click();
  await expect(page.getByRole('progressbar',{name:'첫 레슨 진행도'})).toHaveAttribute('aria-valuenow','1');
  await page.getByRole('button',{name:'카메라로 따라 하기 →'}).click();
  await expect(page.getByLabel('기준 MotionClip JSON 불러오기')).toBeDisabled();
  await page.getByText('기존 연습 MotionClip 불러오기 (선택)',{exact:true}).click();
  await page.getByLabel('기존 연습 MotionClip 불러오기 (선택)').setInputFiles({name:'attempt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clip))});
  await expect(page.getByRole('button',{name:'연습 결과 검토 완료 · 학습으로 돌아가기'})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'연습 결과 검토 완료 · 학습으로 돌아가기'}).click();
  await expect(page.getByRole('progressbar',{name:'첫 레슨 진행도'})).toHaveAttribute('aria-valuenow','2');
  await expect(page.getByText('이 레슨에서 1회 연습 결과를 검토했습니다.',{exact:false})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'학습하기'}).click();
  await expect(page.getByRole('progressbar',{name:'첫 레슨 진행도'})).toHaveAttribute('aria-valuenow','2');
  await expect(page.getByLabel('레슨 기준 동작 JSON')).toBeVisible();
  await expect(page.getByText('학습 자료를 연결하면 이곳에 3D 시범과 반복 재생',{exact:false})).toBeVisible();
  expect(errors).toEqual([]);
});
test('lesson layout fits phone width',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'학습하기'}).click();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
});
