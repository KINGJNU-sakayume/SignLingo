import { test, expect, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { practiceClip } from '../practice-fixtures';

// Constraint correction in Motion Lab. Synthetic geometry (not KSL); the published clip is only read.
const read = async (download: Promise<Download>) => {
  const stream = await (await download).createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString());
};
async function openLab(page: Page, name: string, json: string) {
  await page.goto('/'); await page.getByRole('button', { name: '동작 복원', exact: true }).click();
  await page.locator('input[accept="application/json,.json"]').first().setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByText('동작만 재생 중')).toBeVisible();
}
const SET = { format: 'signlingo.constraints', version: 1, request: '양손이 같은 높이에서 만나야 한다 (브라우저 테스트)', constraints: [
  { id: 'height', kind: 'sameHeight', span: { frames: [10, 30] }, points: ['left.wrist', 'right.wrist'], note: '양손 높이를 맞춘다' },
  { id: 'shape', kind: 'handshape', span: { frames: [0, 30] }, blendMs: 0, hand: 'both', preset: 'index', note: '검지를 편다' },
] };

test('constraint panel previews with a ghost, graphs residuals and exports a corrected version-2 clip', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const clip = practiceClip(); clip.source.name = 'synthetic-constraint.webm'; clip.pipeline.version = '0.2.0';
  await openLab(page, 'synthetic.motion.json', JSON.stringify(clip));
  const panel = page.getByRole('region', { name: '제약 조건 보정' });
  await page.getByRole('button', { name: /^제약 조건 보정/ }).click();
  await expect(panel).toContainText('표정·비수지 신호와 관측되지 않은 미세한 손가락 움직임은 만들어 내지 않습니다');
  await panel.getByText('JSON 붙여넣기').click();
  await page.getByLabel('제약 조건 JSON', { exact: true }).fill('{"format":"signlingo.constraints","version":1,"constraints":[{"id":"x","kind":"sameHeight"}]}');
  await page.getByRole('button', { name: '붙여 넣은 JSON 적용' }).click();
  await expect(page.getByRole('alert')).toContainText('제약 조건 JSON 오류');
  await page.getByLabel('제약 조건 JSON', { exact: true }).fill(JSON.stringify(SET));
  await page.getByRole('button', { name: '붙여 넣은 JSON 적용' }).click();
  await expect(page.locator('.constraint-table tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('보정 미리보기', { exact: true })).toBeChecked();
  await expect(page.getByLabel('보정 미리보기 범례')).toContainText('보정한 손 모양');
  await expect(page.getByLabel('보정 미리보기 범례')).toContainText('보정 전');
  const chart = page.getByRole('img', { name: /^height 잔차/ });
  await expect(chart).toBeVisible();
  await chart.hover({ position: { x: 500, y: 60 } });
  await expect(page.locator('.residual-tooltip')).toContainText('보정 후');
  await expect(page.locator('.constraint-table')).toContainText('→');

  // Add and remove a constraint with the form.
  await page.getByLabel('조건 종류').selectOption('contact');
  await page.getByLabel('점 A').selectOption('left.index.tip'); await page.getByLabel('점 B').selectOption('right.index.tip');
  await page.getByLabel('조건 설명').fill('검지 끝이 닿는다');
  await page.getByRole('button', { name: '조건 추가' }).click();
  await expect(page.locator('.constraint-table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'contact-3 삭제' }).click();
  await expect(page.locator('.constraint-table tbody tr')).toHaveCount(2);

  const exported = await read((async () => { const d = page.waitForEvent('download'); await page.getByRole('button', { name: '제약 조건 JSON 내보내기' }).click(); return d; })());
  expect(exported.constraints.map((c: { id: string }) => c.id)).toEqual(['height', 'shape']);
  expect(exported.constraints[0]).toMatchObject({ blendMs: 100, strength: 1, toleranceCm: 1 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '보정본 내보내기', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('synthetic-constraint.constrained.motion.json');
  const corrected = await read(download);
  expect(corrected.version).toBe(2);
  expect(corrected.pipeline.version).toBe('0.2.0');
  expect(corrected.constraints.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(corrected.constraints.document.constraints).toHaveLength(2);
  expect(corrected.frames.map((f: { hands: unknown }) => f.hands)).toEqual(JSON.parse(JSON.stringify(clip.frames.map(f => f.hands))));
  expect(corrected.frames.filter((f: { constraint?: unknown }) => f.constraint).length).toBeGreaterThan(20);

  // A corrected clip reloads with its recorded document and previews from its source.
  await page.locator('input[accept="application/json,.json"]').first().setInputFiles({ name: 'corrected.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrected)) });
  await expect(panel).toContainText('제약 조건이 적용된 보정본입니다');
  await expect(page.locator('.constraint-table tbody tr')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('the published course-1 meet clip previews the documented meet constraints (read only)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openLab(page, 'reference.motion.json', readFileSync('public/content/assets/ksl-meet/v1/reference.motion.json', 'utf8'));
  await page.getByRole('button', { name: /^제약 조건 보정/ }).click();
  await page.getByLabel('제약 조건 JSON 파일').setInputFiles('docs/constraints/ksl-meet.constraints.json');
  await expect(page.locator('.constraint-table tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'meet-touch', exact: true }).click();
  await expect(page.getByRole('img', { name: /^meet-touch 잔차/ })).toBeVisible();
  await page.getByLabel('재생 위치').fill('2.7');
  await expect(page.getByLabel('보정 미리보기 범례')).toContainText('보정한 손 모양');
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'work/screens/constraints-meet.png', fullPage: true });
  expect(errors).toEqual([]);
});
