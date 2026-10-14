import { test, expect, type Page } from '@playwright/test';
import { approvedCatalogFixture } from '../content-fixtures';
import { Learner, overflow } from './learner';

// Design review captures (SCREENSHOTS=1 npm run test:browser -- screens). Output: work/screens/.
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to capture the design review screenshots.');
test.setTimeout(180_000);

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`learning screens at ${width}×${height}`, async ({ page }) => {
    const shot = async (name: string) => {
      await page.waitForTimeout(500);
      expect(await overflow(page), `${name} must not scroll horizontally`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `work/screens/${width}-${name}.png` });
    };
    await page.setViewportSize({ width, height });
    await page.goto('/'); await shot('path-empty');
    const fixture = await approvedCatalogFixture(['ksl-thanks', 'ksl-sorry', 'ksl-okay', 'ksl-no']);
    await page.route('**/content/manifest.json', route => route.fulfill({ json: fixture.manifest }));
    for (const [uri, bytes] of fixture.assets) await page.route('**/' + uri, route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/json' }));
    await page.reload(); await shot('path');
    await page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' }).click(); await shot('popover');
    await page.getByRole('button', { name: '단원 1 가이드북' }).click(); await shot('guidebook');
    await page.getByRole('button', { name: new RegExp(fixture.entries[0].displayName) }).click();
    await expect(page.locator('.ec-stage canvas')).toBeVisible(); await shot('card');
    for (const [view, label] of [['front', '정면'], ['side', '측면'], ['first', '1인칭'], ['hands', '손 확대']]) {
      await page.getByRole('group', { name: '시범 카메라 시점' }).getByRole('button', { name: label, exact: true }).click(); await shot(`card-${view}`);
    }
    await page.getByRole('button', { name: '가이드북', exact: true }).click();
    await page.getByRole('button', { name: '학습 경로', exact: true }).click();
    await page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' }).click();
    await page.getByRole('button', { name: '시작', exact: true }).click();
    const seen = new Set<string>();
    const once = async (name: string) => { if (!seen.has(name)) { seen.add(name); await shot(name); } };
    const learner = new Learner(page, fixture.entries[0].displayName, true);
    learner.onStep = kind => once(`step-${kind}`);
    learner.onSelected = kind => once(`step-${kind}-selected`);
    learner.onSheet = tone => once(`sheet-${tone}`);
    await learner.until(null, async () => camera(page, fixture.clips[1], once));
    await shot('complete');
    await page.getByRole('button', { name: '계속', exact: true }).click(); await shot('path-after');
    await page.getByRole('button', { name: '복습', exact: true }).click(); await shot('review');
  });
}
async function camera(page: Page, clip: unknown, once: (name: string) => Promise<void>) {
  await once('step-camera');
  await page.getByRole('button', { name: '카메라로 따라 하기' }).click();
  await page.getByText('기존 연습 MotionClip 불러오기 (선택)', { exact: true }).click();
  await page.getByLabel('기존 연습 MotionClip 불러오기 (선택)').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clip)) });
  await page.getByRole('button', { name: '연습 결과 검토 완료 · 학습으로 돌아가기' }).click();
  await expect(page.locator('.sl-sheet-neutral')).toBeVisible(); await once('sheet-neutral');
  await page.getByRole('button', { name: '계속', exact: true }).click();
}
