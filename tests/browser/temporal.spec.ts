import { test, expect, type Page } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from '../articulation';
import { fixtureClip } from '../fixtures';
import { Reconstructor } from '../../src/motion/reconstruct';

function clipFixture(count = 7) {
  const clip = fixtureClip(), solver = new Reconstructor();
  clip.pipeline.version = '0.2.0'; clip.source.duration = count / 30; clip.source.sampleHz = 30;
  clip.frames = Array.from({ length: count }, (_, i) => {
    const d = articulatedDetection({ timestamp: i * 1000 / 30, flex: [.2, .3, .2], spread: .1,
      palm: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i * .01)) });
    if (i === 2) d.hands = [];
    return solver.reconstruct(d);
  });
  return clip;
}
async function open(page: Page, clip: ReturnType<typeof clipFixture>) {
  await page.goto('/'); await page.getByRole('button', { name: '동작 복원', exact: true }).click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({ name: 'synthetic-temporal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clip)) });
}

test('compares the same timestamp, labels inference and exports only original evidence plus edits', async ({ page }) => {
  const clip = clipFixture(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page, clip);
  const comparison = page.getByLabel('시간 복원 비교', { exact: true });
  await expect(comparison).toContainText('왼손: 관측');
  await page.getByLabel('재생 위치', { exact: true }).fill('0.067');
  await expect(comparison).toContainText('왼손: 시간 보간');
  await page.getByLabel('시간 복원 선택').selectOption('original');
  await expect(comparison).toContainText('왼손: 임시 유지');
  await expect(page.getByLabel('재생 위치', { exact: true })).toHaveValue('0.067');
  await page.getByLabel('시간 복원 선택').selectOption('enhanced');
  await page.getByRole('button', { name: '0.5×', exact: true }).click();
  await page.getByRole('button', { name: '측면', exact: true }).click();
  await page.locator('summary').click();
  await page.getByLabel('굽힘 correction', { exact: true }).fill('10');
  await page.getByRole('button', { name: '현재 프레임 보정 저장', exact: true }).click();
  await expect(comparison).toContainText('왼손: 시간 보간');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.frames).toEqual(JSON.parse(JSON.stringify(clip.frames)));
  expect(exported.edits).toEqual([{ frame: 2, side: 'left', degrees: [10, 0, 0] }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'work/temporal-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile temporal processing can be canceled without changing baseline playback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, clipFixture(240));
  await page.getByRole('button', { name: '시간 복원 취소', exact: true }).click();
  await expect(page.getByLabel('시간 복원 선택')).toHaveValue('original');
  await page.getByLabel('재생 위치', { exact: true }).fill('0.067');
  await expect(page.getByLabel('시간 복원 비교', { exact: true })).toContainText('왼손: 임시 유지');
  await expect(page.getByRole('button', { name: 'JSON 내보내기', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('partial reconstruction exposes unavailable fingers rather than displaying an invented shape', async ({ page }) => {
  const clip = clipFixture();
  clip.frames[3].pose.rotations['left.index.1'] = [Math.sin(.8), 0, 0, Math.cos(.8)];
  await open(page, clip);
  await expect(page.getByLabel('시간 복원 비교', { exact: true })).toContainText('왼손: 관측');
  await page.getByLabel('재생 위치', { exact: true }).fill('0.067');
  await expect(page.getByLabel('시간 복원 비교', { exact: true })).toContainText('왼손: 시간 보간 (손가락 사용 불가)');
});
