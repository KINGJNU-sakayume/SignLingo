// Captures the learner-screen 3D demonstration of private review packages for the reviewers.
// Uses the development-only review preview (`/?review=1`), so start `npm run dev` first.
//
//   node scripts/review-shots.mjs ksl-thanks ksl-sorry [--frames 6] [--views front,side,first,hands] [--url http://127.0.0.1:5173]
//
// Writes work/screens/review-<id>-<view>.png (one sheet per view, frames left to right with their times).
// Avatar renderings only: the original video is never captured.
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const LABELS = { front: '정면', side: '측면', first: '1인칭', hands: '손 확대' };
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args.splice(i, 2)[1]; };
const base = option('url', 'http://127.0.0.1:5173');
const frames = Math.max(1, Number(option('frames', '6')));
const views = option('views', 'front,side,first,hands').split(',').filter(view => view in LABELS);
const ids = args.filter(arg => !arg.startsWith('--'));
if (!ids.length) throw new Error('usage: node scripts/review-shots.mjs <package-id>... [--frames n] [--views front,side,first,hands] [--url dev-server]');

await mkdir('work/screens', { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--enable-unsafe-swiftshader'] });
try {
  for (const id of ids) {
    const entry = JSON.parse(await readFile(`private-data/${id}/entry.json`, 'utf8'));
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/?review=1`);
    await page.getByRole('button', { name: /가이드북$/ }).first().waitFor();
    // The expression card is reached from its unit's guidebook.
    const unit = page.locator(`#unit-${entry.lessonId}`);
    await (await unit.count() ? unit.getByRole('button', { name: /가이드북$/ }) : page.getByRole('button', { name: /가이드북$/ }).first()).click();
    await page.locator('.gb-item', { hasText: entry.displayName }).first().click();
    const scrub = page.getByRole('slider', { name: '시범 재생 위치' });
    await scrub.waitFor();
    const duration = Number(await scrub.getAttribute('max'));
    const times = Array.from({ length: frames }, (_, k) => frames === 1 ? duration / 2 : duration * (0.05 + 0.9 * k / (frames - 1)));
    for (const view of views) {
      await page.getByRole('group', { name: '시범 카메라 시점' }).getByRole('button', { name: LABELS[view], exact: true }).click().catch(() =>
        page.locator('.ec-stage-card').getByRole('button', { name: LABELS[view], exact: true }).click());
      const shots = [];
      for (const t of times) {
        await scrub.evaluate((input, value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, t);
        await page.waitForTimeout(400);
        shots.push({ t, png: (await page.locator('.ec-stage').screenshot()).toString('base64') });
      }
      // One sheet per view: frames side by side with their times.
      const sheet = await browser.newPage({ viewport: { width: 300 * shots.length, height: 100 } });
      await sheet.setContent(`<body style="margin:0;display:flex;font:14px sans-serif;background:#fff">${shots.map(s =>
        `<figure style="margin:0;width:300px"><img src="data:image/png;base64,${s.png}" style="width:300px"><figcaption style="text-align:center">${entry.id} r${entry.revision} · ${LABELS[view]} · ${s.t.toFixed(2)} s</figcaption></figure>`).join('')}</body>`);
      const path = `work/screens/review-${entry.id}-${view}.png`;
      await sheet.screenshot({ path, fullPage: true });
      await sheet.close();
      console.log(path);
    }
    await page.close();
  }
} finally { await browser.close(); }
