import { expect, type Page } from '@playwright/test';
import { approvedCatalogFixture } from '../content-fixtures';

// Fixtures are injected only through intercepted responses; nothing is added to public/.
export async function routes(page: Page) {
  const fixture = await approvedCatalogFixture();
  await page.route('**/content/manifest.json', route => route.fulfill({ json: fixture.manifest }));
  for (const [uri, bytes] of fixture.assets) await page.route('**/' + uri, route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/json' }));
  return fixture;
}
export const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

/** Answers the current lesson from what the screen shows. Missed questions are remembered for their retry. */
export class Learner {
  pending: (string | number)[] = []; missed = 0; retried = 0;
  /** Optional observers, used by the screenshot review spec. */
  onStep?: (kind: string) => Promise<void>; onSelected?: (kind: string) => Promise<void>; onSheet?: (tone: 'correct' | 'wrong') => Promise<void>;
  constructor(private page: Page, private target: string, private missFirst = false) {}
  async progress() {
    const bar = this.page.getByRole('progressbar', { name: /진행도/ });
    return { done: Number(await bar.getAttribute('aria-valuenow')), total: Number(await bar.getAttribute('aria-valuemax')) };
  }
  kind() { return this.page.locator('.lp').getAttribute('data-step-kind'); }
  async answer() {
    const page = this.page, kind = await this.kind(), choices = page.locator('.lp-choices [data-choice]');
    const { done, total } = await this.progress();
    const retry = this.pending.length > 0 && done + this.pending.length === total;
    let pick: number;
    if (retry) {
      const known = this.pending.shift()!; this.retried++;
      pick = typeof known === 'number' ? known : (await choices.allInnerTexts()).findIndex(text => text.includes(known));
    } else if (kind === 'pick-meaning') {
      const texts = await choices.allInnerTexts();
      pick = Math.max(0, texts.findIndex(text => this.missFirst && !this.missed ? !text.includes(this.target) : text.includes(this.target)));
    } else pick = 0;
    await choices.nth(pick).click();
    await expect(choices.nth(pick)).toHaveAttribute('aria-pressed', 'true');
    await this.onSelected?.(kind!);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    const sheet = page.locator('.sl-sheet');
    await expect(sheet).toBeVisible();
    const wrong = await sheet.evaluate(element => element.classList.contains('sl-sheet-wrong'));
    await this.onSheet?.(wrong ? 'wrong' : 'correct');
    if (wrong) {
      this.missed++;
      const correct = await choices.evaluateAll(elements => elements.findIndex(e => e.classList.contains('is-correct')));
      const count = await choices.count(), text = (await choices.nth(correct).innerText()).replace(/^\d+\s*/, '').trim();
      if (kind === 'pick-meaning') await expect(sheet).toContainText(`정답: ${text}`);
      // A missed question returns at the end with its options rotated one place (session.ts rotate()).
      this.pending.push(kind === 'pick-sign' ? (correct - 1 + count) % count : text);
      await page.getByRole('button', { name: '확인했어요' }).click();
      expect((await this.progress()).done).toBe(done);
    } else {
      await page.getByRole('button', { name: '계속', exact: true }).click();
      // The last correct answer ends the lesson and replaces the player with the completion screen.
      if (done + 1 < total) expect((await this.progress()).done).toBe(done + 1);
    }
  }
  /** Plays until the given step kind or the end of the lesson. */
  async until(stop: string | null, onCamera?: () => Promise<void>) {
    for (let guard = 0; guard < 40; guard++) {
      if (await this.page.locator('.lc').count()) return;
      const kind = await this.kind();
      if (kind === stop) return;
      await this.onStep?.(kind!);
      if (kind === 'intro') await this.page.getByRole('button', { name: '계속', exact: true }).click();
      else if (kind === 'camera') {
        if (onCamera) { await onCamera(); continue; }
        const before = await this.progress();
        await this.page.getByRole('button', { name: '지금은 카메라를 쓸 수 없어요' }).click();
        await expect.poll(async () => (await this.progress()).total).toBe(before.total - 1);
      } else await this.answer();
    }
    throw new Error('Lesson did not finish');
  }
}
export async function startFirstLesson(page: Page) {
  await page.getByRole('button', { name: '단원 1 레슨 1 · 지금 할 차례' }).click();
  await expect(page.getByRole('group', { name: '레슨 1 / 1' })).toContainText('새 표현 1개');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.locator('.lp')).toHaveAttribute('data-step-kind', 'intro');
}
