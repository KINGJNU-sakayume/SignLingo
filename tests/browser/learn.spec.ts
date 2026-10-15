import { test, expect } from '@playwright/test';
import { progressKey } from '../../src/lessons/catalog';
import { nodeId } from '../../src/learn/path';
import { Learner, overflow, routes, startFirstLesson } from './learner';

test('a lesson runs from the path through feedback, a retried miss and completion, and persists', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { entries } = await routes(page); const target = entries[0].displayName;
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: '첫 레슨을 준비하고 있어요' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '단원 2 레슨 1 · 잠김' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await startFirstLesson(page);
  await expect(page.locator('.lp-stage canvas')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: target })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expect(page.getByRole('group', { name: '시범 시점' }).getByRole('button')).toHaveText(['정면', '1인칭', '손 확대']);
  await expect(page.getByRole('button', { name: '0.5배속' })).toBeVisible();
  // The description and movement notes sit under the 3D stage, never on top of it or under the footer.
  const caption = page.locator('.lp-stage-card .sl-caption');
  await expect(caption).toContainText(entries[0].description);
  for (const note of entries[0].movementNotes) await expect(caption).toContainText(note);
  const canvas = (await page.locator('.lp-stage canvas').boundingBox())!;
  expect((await caption.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  // Scroll it clear of the fixed footer (a caption above the fold can still sit under the footer).
  await caption.evaluate(element => element.scrollIntoView({ block: 'center' }));
  expect(await caption.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.left + box.width / 2, box.bottom - 4)); })).toBe(true);
  const learner = new Learner(page, target, true);
  await learner.until(null);
  expect(learner.missed).toBeGreaterThan(0); expect(learner.retried).toBe(learner.missed);
  await expect(page.getByRole('heading', { name: '레슨 완료!' })).toBeVisible();
  await expect(page.getByText('보고 이해하기')).toBeVisible();
  await expect(page.locator('.lc')).not.toContainText('%');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByRole('button', { name: '단원 1 레슨 1 · 완료' })).toBeVisible();
  await expect(page.getByRole('button', { name: '단원 1 단원 복습 · 지금 할 차례' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '단원 1 레슨 1 · 완료' })).toBeVisible();
  await page.getByRole('button', { name: '복습', exact: true }).click();
  await expect(page.getByText('지금은 복습할 표현이 없어요')).toBeVisible();
  await expect(page.getByRole('region', { name: '오늘의 복습' })).toContainText('다음 복습: 내일');
  await expect(page.getByRole('button', { name: new RegExp(target) })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard control, exit confirmation and the camera step round trip through Practice', async ({ page }) => {
  const { entries, clips } = await routes(page); const target = entries[0].displayName;
  await page.goto('/'); await startFirstLesson(page);
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog', { name: '레슨을 나갈까요?' });
  await expect(dialog).toContainText('지금 나가면 이번 레슨 진행이 저장되지 않아요');
  await expect(page.getByRole('button', { name: '계속 학습하기' })).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '계속 학습하기' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.lp')).toHaveAttribute('data-step-kind', 'pick-meaning');
  // Graded questions keep the description hidden until the answer is checked.
  await expect(page.locator('.sl-caption')).toHaveCount(0);
  const texts = await page.locator('.lp-choices [data-choice]').allInnerTexts();
  await page.keyboard.press(String(texts.findIndex(text => text.includes(target)) + 1));
  await page.keyboard.press('Enter');
  await expect(page.locator('.sl-sheet-correct')).toBeVisible();
  await expect(page.locator('.sl-sheet')).toContainText(entries[0].description);
  await page.keyboard.press('Enter');
  await expect(page.locator('.sl-sheet')).toHaveCount(0);
  const learner = new Learner(page, target);
  await learner.until('camera');
  const before = await learner.progress();
  await page.getByRole('button', { name: '카메라로 따라 하기' }).click();
  await expect(page.getByLabel('기준 MotionClip JSON 불러오기')).toBeDisabled();
  await page.getByRole('button', { name: '← 학습 과정으로 돌아가기' }).click();
  await expect(page.locator('.lp')).toHaveAttribute('data-step-kind', 'camera');
  expect(await learner.progress()).toEqual(before);
  await page.getByRole('button', { name: '카메라로 따라 하기' }).click();
  await page.getByText('기존 연습 MotionClip 불러오기 (선택)', { exact: true }).click();
  await page.getByLabel('기존 연습 MotionClip 불러오기 (선택)').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(clips[1])) });
  await page.getByRole('button', { name: '연습 결과 검토 완료 · 학습으로 돌아가기' }).click();
  const sheet = page.locator('.sl-sheet-neutral');
  await expect(sheet).toContainText('연습 기록을 남겼어요');
  await expect(sheet).toContainText('동작 비교는 정답 판정이 아니에요');
  await expect(sheet).not.toContainText(/%|정답!|오답|점수|정확도/);
  await page.getByRole('button', { name: '계속', exact: true }).click();
  expect((await learner.progress()).done).toBe(before.done + 1);
  await learner.until(null);
  await expect(page.locator('.lc')).toContainText('따라 하기');
  await expect(page.locator('.lc')).toContainText('1회');
});

test('leaving a lesson keeps the path unchanged', async ({ page }) => {
  await routes(page); await page.goto('/'); await startFirstLesson(page);
  await page.getByRole('button', { name: '거울 모드', exact: true }).click();
  await expect(page.locator('.lp-stage .sl-mirror-badge')).toHaveText('거울 모드');
  await page.getByRole('button', { name: '계속', exact: true }).click();
  // The mirror view stays on across steps; graded steps still show the badge.
  await expect(page.locator('.lp-stage .sl-mirror-badge')).toHaveText('거울 모드');
  await page.getByRole('button', { name: '레슨 나가기' }).click();
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  await expect(page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' })).toBeVisible();
});

test('due expressions come back in the review tab and reschedule after a review', async ({ page }) => {
  const { entries } = await routes(page), [first] = entries;
  const store = { version: 2, settings: { sound: false },
    nodes: { [nodeId('lesson', first.lessonId, [first])]: { completedAt: '2026-10-01T00:00:00.000Z', runs: 1 } },
    expressions: { [progressKey(first)]: { box: 1, due: '2026-10-02T00:00:00.000Z', seen: 1, correct: 1, wrong: 0 } } };
  await page.addInitScript(value => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('signlingo.learn.v2', value); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(store));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '단원 1 레슨 1 · 복습할 때예요' })).toBeVisible();
  await page.getByRole('button', { name: '복습', exact: true }).click();
  await expect(page.getByText('복습할 표현 1개')).toBeVisible();
  await page.getByRole('button', { name: '복습 시작' }).click();
  await expect(page.getByRole('progressbar', { name: '복습 진행도' })).toBeVisible();
  const learner = new Learner(page, first.displayName);
  await learner.until(null);
  await expect(page.getByRole('heading', { name: '복습 완료!' })).toBeVisible();
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByText('지금은 복습할 표현이 없어요')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('signlingo.learn.v2')!));
  const record = saved.expressions[progressKey(first)];
  expect(Date.parse(record.due)).toBeGreaterThan(Date.now()); expect(record.seen).toBe(2);
  // Leitner: a clean review moves the card up a box; any first-try miss sends it back to box 1.
  expect(record.box).toBe(learner.missed ? 1 : 2);
});

test('reduced motion replaces movement with fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { entries } = await routes(page); await page.goto('/');
  await expect.poll(() => page.locator('.sl-node-bubble').evaluate(element => getComputedStyle(element).animationIterationCount)).toBe('1');
  await startFirstLesson(page);
  await page.getByRole('button', { name: '계속', exact: true }).click();
  const choices = page.locator('.lp-choices [data-choice]');
  await choices.nth((await choices.allInnerTexts()).findIndex(text => text.includes(entries[0].displayName))).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect.poll(() => page.locator('.sl-sheet').evaluate(element => getComputedStyle(element).animationName)).toBe('sl-fade');
});

test('keyboard shortcuts work the moment the first step appears', async ({ page }) => {
  // Dispatches Escape from a MutationObserver, before any later task: listeners must already be attached.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.lp[data-step-kind]')) return;
      observer.disconnect();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await routes(page); await page.goto('/');
  await page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' }).click();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '레슨을 나갈까요?' })).toBeVisible();
});
