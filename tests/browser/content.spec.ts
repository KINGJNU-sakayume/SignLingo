import { test, expect, type Page } from '@playwright/test';
import { approvedFixture } from '../content-fixtures';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { reviewSubject } from '../../src/content/validation';
import deployed from '../../public/content/manifest.json' with { type: 'json' };

// Only intercepted responses contain fixtures; synthetic lessons never enter production public/.
async function fixtureRoutes(page: Page, options: Parameters<typeof approvedFixture>[1] = {}) {
  const fixture = await approvedFixture(undefined, options);
  await page.route('**/content/manifest.json', route => route.fulfill({ json: fixture.manifest }));
  await page.route('**/' + fixture.entry.assets.motion!.uri, route => route.fulfill({ body: Buffer.from(fixture.bytes), contentType: 'application/json' }));
  return fixture;
}
async function openCard(page: Page, name: string) {
  await page.getByRole('button', { name: '단원 1 가이드북' }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test('learner home shows upcoming units without upload controls or fake playable lessons', async ({ page }) => {
  // The empty state is still reachable for any deployment with no published expression.
  await page.route('**/content/manifest.json', route => route.fulfill({ json: { ...deployed, expressions: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '첫 레슨을 준비하고 있어요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '한국수어사전 열기' })).toHaveAttribute('href', 'https://sldict.korean.go.kr/');
  const upcoming = page.getByRole('button', { name: '준비 중 · 아직 시작할 수 없어요' });
  await expect(upcoming).toHaveCount(15);
  for (const node of await upcoming.all()) await expect(node).toBeDisabled();
  await expect(page.getByText('준비 중이에요 · 원본 이용 허락과 한국수어 검수를 마친 표현부터 열려요')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '시작', exact: true })).toHaveCount(0);
  await expect(page.locator('.sl-learn input[type=file]')).toHaveCount(0);
  await page.getByRole('button', { name: '단원 1 가이드북' }).click();
  await expect(page.getByRole('heading', { name: '준비 중이에요' })).toBeVisible();
  await page.getByRole('button', { name: '복습', exact: true }).click();
  await expect(page.getByText('지금은 복습할 표현이 없어요')).toBeVisible();
});
test('prepackaged reference loads into Practice and keeps per-version history after returning and reloading', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { entry, clip } = await fixtureRoutes(page);
  await page.goto('/');
  await openCard(page, entry.displayName);
  await expect(page.locator('.ec-stage canvas')).toBeVisible();
  await expect(page.getByRole('group', { name: '시범 카메라 시점' }).getByRole('button')).toHaveText(['정면', '측면', '1인칭', '손 확대']);
  await expect(page.getByRole('button', { name: '뒤에서' })).toHaveCount(0);
  await page.getByRole('button', { name: '0.5배속' }).click();
  await expect(page.getByRole('button', { name: '0.5배속' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '측면', exact: true }).click();
  await page.getByRole('button', { name: '시범 재생', exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel('시범 재생 위치').inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('button', { name: '시범 확인 완료' }).click();
  await expect(page.getByText('시범 관찰 완료')).toBeVisible();
  await page.getByRole('button', { name: '카메라로 따라 하기' }).click();
  await expect(page.getByLabel('기준 MotionClip JSON 불러오기')).toBeDisabled();
  await expect(page.getByLabel('표시 언어')).toHaveCount(0);
  await page.getByText('기존 연습 MotionClip 불러오기 (선택)', { exact: true }).click();
  await page.getByLabel('기존 연습 MotionClip 불러오기 (선택)').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clip)) });
  await page.getByRole('button', { name: '연습 결과 검토 완료 · 학습으로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: '연습 기록 · 1회' })).toBeVisible();
  await expect(page.getByText('따라 하기 1회')).toBeVisible();
  await page.reload();
  await openCard(page, entry.displayName);
  await expect(page.getByRole('heading', { name: '연습 기록 · 1회' })).toBeVisible();
  await page.getByText('출처와 이용 조건', { exact: true }).click();
  await expect(page.getByText(entry.source.attribution, { exact: true })).toBeVisible();
  await expect(page.getByText(entry.license.type, { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
test('expression card: description, rest legend, persistent mirror mode and A–B repeat', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { entry } = await fixtureRoutes(page, { missingLeadHand: true });
  await page.goto('/'); await openCard(page, entry.displayName);
  await expect(page.locator('.ec-stage canvas')).toBeVisible();
  const explain = page.locator('.ec-explain');
  await expect(explain).toContainText(entry.description);
  for (const note of entry.movementNotes) await expect(explain).toContainText(note);
  // A hand lost before the sign rests (gray, legend) instead of showing an estimated sign handshape.
  await expect(page.getByText('회색 팔·손: 수어 앞뒤의 쉬는 자세', { exact: true })).toBeVisible();
  await expect(page.getByText('추정으로 채운 손 모양', { exact: true })).toHaveCount(0);

  const mirror = page.getByRole('button', { name: '거울 모드', exact: true }), badge = page.locator('.ec-stage .sl-mirror-badge');
  const views = page.getByRole('group', { name: '시범 카메라 시점' });
  await expect(mirror).toHaveAttribute('aria-pressed', 'false'); await expect(badge).toHaveCount(0);
  await mirror.click();
  await expect(badge).toHaveText('거울 모드');
  await views.getByRole('button', { name: '1인칭', exact: true }).click();
  await expect(badge).toHaveText('1인칭 · 거울 모드 꺼짐');
  await views.getByRole('button', { name: '손 확대', exact: true }).click();
  await expect(badge).toHaveText('거울 모드');
  await page.reload(); await openCard(page, entry.displayName);
  await expect(mirror).toHaveAttribute('aria-pressed', 'true'); await expect(badge).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('signlingo.learn.v2')!).settings.mirror)).toBe(true);

  const position = page.getByLabel('시범 재생 위치');
  await position.fill('0.4'); await page.getByRole('button', { name: '구간 시작(A) 지정' }).click();
  await position.fill('1'); await page.getByRole('button', { name: '구간 끝(B) 지정' }).click();
  await expect(page.getByRole('group', { name: '구간 반복' })).toContainText('구간 반복 0.4초–1.0초');
  await page.getByRole('button', { name: '시범 재생', exact: true }).click();
  const seen: number[] = [];
  for (let i = 0; i < 25; i++) { seen.push(Number(await position.inputValue())); await page.waitForTimeout(80); }
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(.39); expect(Math.max(...seen)).toBeLessThanOrEqual(1.01);
  expect(seen.some((value, i) => i > 0 && value < seen[i - 1]), 'playback wraps from B back to A').toBe(true);
  await page.getByRole('button', { name: '구간 반복 해제' }).click();
  await expect(page.getByRole('group', { name: '구간 반복' })).not.toContainText('구간 반복 0.4초');
  expect(errors).toEqual([]);
});
test('missing or corrupted media blocks practice and supports retry', async ({ page }) => {
  const { entry, bytes } = await fixtureRoutes(page); let failing = true;
  await page.route('**/' + entry.assets.motion!.uri, route => route.fulfill(failing ? { status: 404 } : { body: Buffer.from(bytes), contentType: 'application/json' }));
  await page.goto('/'); await openCard(page, entry.displayName);
  await expect(page.getByRole('alert')).toContainText('검증하지 못했어요');
  await expect(page.getByRole('button', { name: '카메라로 따라 하기' })).toHaveCount(0);
  failing = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('button', { name: '카메라로 따라 하기' })).toBeEnabled();
});
test('a lesson whose motion fails integrity checks cannot start and offers retry', async ({ page }) => {
  const { entry, bytes } = await fixtureRoutes(page); let corrupt = true;
  await page.route('**/' + entry.assets.motion!.uri, route => route.fulfill({ body: Buffer.from(corrupt ? bytes.map(b => b ^ 1) : bytes), contentType: 'application/json' }));
  await page.goto('/');
  await page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' }).click();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('검증하지 못했어요');
  await expect(page.locator('.lp')).toHaveCount(0);
  corrupt = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.lp')).toHaveAttribute('data-step-kind', 'intro');
});
test('a forged published flag is not accepted by the learner manifest', async ({ page }) => {
  const { manifest } = await approvedFixture(); manifest.expressions[0].reviews.linguistic = { status: 'pending' };
  await page.route('**/content/manifest.json', route => route.fulfill({ json: manifest }));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('학습 목록을 불러오지 못했어요');
  await expect(page.getByRole('button', { name: '시작', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
});
test('phone navigation, expression card and return to the learning path fit the viewport', async ({ page }) => {
  const { entry } = await fixtureRoutes(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('navigation', { name: '주요 메뉴' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await openCard(page, entry.displayName);
  await expect(page.getByRole('button', { name: '카메라로 따라 하기' })).toBeVisible();
  await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'work/content-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '카메라로 따라 하기' }).click();
  await page.getByRole('button', { name: '← 학습 과정으로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: entry.displayName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '가이드북', exact: true }).click();
  await page.getByRole('button', { name: '학습 경로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '첫 만남과 예의' })).toBeVisible();
});
test('GitHub Pages subpath resolves the content manifest relative to the application', async ({ page }) => {
  // Serve the actual production build beneath the repository path, as Pages does.
  await page.route('**/SignLingo/**', async route => {
    const file = new URL(route.request().url()).pathname.slice('/SignLingo/'.length) || 'index.html';
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
    try { await route.fulfill({ body: await readFile('dist/' + file), contentType: types[extname(file)] ?? 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  const request = page.waitForRequest('**/SignLingo/content/manifest.json');
  await page.goto('/SignLingo/'); expect((await request).url()).toContain('/SignLingo/content/manifest.json');
  // The deployed manifest publishes course 1; it must parse with its real evidence and open its first lesson.
  await expect(page.getByRole('heading', { name: '첫 만남과 예의' })).toBeVisible();
  await expect(page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' })).toBeVisible();
});
test('unavailable original video leaves verified 3D practice available', async ({ page }) => {
  const { entry, manifest, bytes } = await approvedFixture();
  entry.assets.video = { uri: `https://media.example.org/v${entry.revision}/original.mp4`, sha256: entry.source.videoSha256!, bytes: 100, version: entry.revision, mediaType: 'video/mp4' };
  for (const review of Object.values(entry.reviews)) review.subjectSha256 = await reviewSubject(entry);
  await page.route('**/content/manifest.json', route => route.fulfill({ json: manifest }));
  await page.route('**/' + entry.assets.motion!.uri, route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/json' }));
  await page.route('https://media.example.org/**', route => route.abort());
  await page.goto('/'); await openCard(page, entry.displayName);
  await expect(page.getByText('원본 영상을 불러오지 못했어요.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '카메라로 따라 하기' })).toBeEnabled();
});
