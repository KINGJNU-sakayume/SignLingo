import { test, expect, type Page } from '@playwright/test';
import { approvedFixture } from '../content-fixtures';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { reviewSubject } from '../../src/content/validation';

// Only intercepted responses contain fixtures. Production public/ remains empty.
async function fixtureRoutes(page: Page) {
  const fixture = await approvedFixture();
  await page.route('**/content/manifest.json', route => route.fulfill({ json: fixture.manifest }));
  await page.route('**/' + fixture.entry.assets.motion!.uri, route => route.fulfill({ body: Buffer.from(fixture.bytes), contentType: 'application/json' }));
  return fixture;
}
test('learner home shows upcoming courses without upload controls or fake playable lessons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '수어를 보고, 따라 하고, 복습하세요.' })).toBeVisible();
  await expect(page.getByText('현재 공개된 3D 레슨이 없습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '준비 중 · 아직 시작할 수 없습니다' })).toHaveCount(5);
  await expect(page.getByRole('button', { name: '준비 중 · 아직 시작할 수 없습니다' }).first()).toBeDisabled();
  await expect(page.locator('.lesson-hub input[type=file]')).toHaveCount(0);
  await page.getByRole('button', { name: '복습하기 · 0개' }).click();
  await expect(page.getByRole('heading', { name: '다시 살펴볼 표현' })).toBeVisible();
});
test('prepackaged reference loads into Practice and keeps per-version history after returning and reloading', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { entry, clip } = await fixtureRoutes(page);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(entry.displayName) }).click();
  await expect(page.locator('.lesson-reference canvas')).toBeVisible();
  await page.getByLabel('시범 재생 속도').selectOption('0.5');
  await page.getByRole('button', { name: '측면', exact: true }).click();
  await page.getByRole('button', { name: '시범 재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('시범 재생 위치').inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('button', { name: '시범 확인 완료' }).click();
  await page.getByRole('button', { name: '카메라로 따라 하기 →' }).click();
  await expect(page.getByLabel('기준 MotionClip JSON 불러오기')).toBeDisabled();
  await expect(page.getByLabel('표시 언어')).toHaveCount(0);
  await page.getByText('기존 연습 MotionClip 불러오기 (선택)', { exact: true }).click();
  await page.getByLabel('기존 연습 MotionClip 불러오기 (선택)').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clip)) });
  await page.getByRole('button', { name: '연습 결과 검토 완료 · 학습으로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: '연습 기록 · 1회' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '레슨 진행도' })).toHaveAttribute('aria-valuenow', '2');
  await page.reload();
  await page.getByRole('button', { name: '복습하기 · 1개' }).click();
  await page.getByRole('button', { name: new RegExp(entry.displayName) }).first().click();
  await expect(page.getByRole('heading', { name: '연습 기록 · 1회' })).toBeVisible();
  await page.getByText('출처와 이용 조건', { exact: true }).click();
  await expect(page.getByText(entry.source.attribution, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('missing or corrupted media blocks practice and supports retry', async ({ page }) => {
  const { entry, bytes } = await fixtureRoutes(page); let failing = true;
  await page.route('**/' + entry.assets.motion!.uri, route => route.fulfill(failing ? { status: 404 } : { body: Buffer.from(bytes), contentType: 'application/json' }));
  await page.goto('/'); await page.getByRole('button', { name: new RegExp(entry.displayName) }).click();
  await expect(page.getByRole('alert')).toContainText('검증하지 못했습니다');
  await expect(page.getByRole('button', { name: '카메라로 따라 하기 →' })).toHaveCount(0);
  failing = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('button', { name: '카메라로 따라 하기 →' })).toBeEnabled();
});
test('a forged published flag is not accepted by the learner manifest', async ({ page }) => {
  const { manifest } = await approvedFixture(); manifest.expressions[0].reviews.linguistic = { status: 'pending' };
  await page.route('**/content/manifest.json', route => route.fulfill({ json: manifest }));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('학습 목록을 불러오지 못했습니다');
  await expect(page.getByRole('button', { name: '카메라로 따라 하기 →' })).toHaveCount(0);
});
test('phone navigation, lesson controls and return to the learning path fit the viewport', async ({ page }) => {
  const { entry } = await fixtureRoutes(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: new RegExp(entry.displayName) }).click();
  await expect(page.getByRole('button', { name: '카메라로 따라 하기 →' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'work/content-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '카메라로 따라 하기 →' }).click();
  await page.getByRole('button', { name: '← 학습 과정으로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: entry.displayName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 학습 과정으로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '첫 만남과 예의' })).toBeVisible();
});
test('GitHub Pages subpath resolves the content manifest relative to the application', async ({ page }) => {
  // Serve the actual production build beneath the repository path, as Pages does.
  await page.route('**/SignLingo/**', async route => {
    const file = new URL(route.request().url()).pathname.slice('/SignLingo/'.length) || 'index.html';
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    try { await route.fulfill({ body: await readFile('dist/' + file), contentType: types[extname(file)] ?? 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  const request = page.waitForRequest('**/SignLingo/content/manifest.json');
  await page.goto('/SignLingo/'); expect((await request).url()).toContain('/SignLingo/content/manifest.json');
  await expect(page.getByText('현재 공개된 3D 레슨이 없습니다.', { exact: false })).toBeVisible();
});
test('unavailable original video leaves verified 3D practice available', async ({ page }) => {
  const { entry, manifest, bytes } = await approvedFixture();
  entry.assets.video = { uri: 'https://media.example.org/v1/original.mp4', sha256: entry.source.videoSha256!, bytes: 100, version: 1, mediaType: 'video/mp4' };
  for (const review of Object.values(entry.reviews)) review.subjectSha256 = await reviewSubject(entry);
  await page.route('**/content/manifest.json', route => route.fulfill({ json: manifest }));
  await page.route('**/' + entry.assets.motion!.uri, route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/json' }));
  await page.route('https://media.example.org/**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: new RegExp(entry.displayName) }).click();
  await expect(page.getByText('원본 영상을 불러오지 못했습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '카메라로 따라 하기 →' })).toBeEnabled();
});
