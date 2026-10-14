import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { MODELS } from '../motion/types';
import type { HarnessResult, HarnessRun } from './harness/main';
import type { ModelName } from './models';

export type Session = {
  browser: string;
  /** External requests the page attempted; every one is aborted. */
  blocked: string[];
  process(video: string, run: HarnessRun): Promise<HarnessResult>;
  close(): Promise<void>;
};
const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * Builds the harness (same Vite worker settings as the app), serves it on 127.0.0.1 and opens headless Chromium.
 * Model and WASM URLs are answered from the hash-checked cache and node_modules; any other off-machine request
 * is aborted, so videos and landmarks never leave the computer.
 */
export async function openSession(options: { models: Record<ModelName, string>; wasmDir: string; channel?: string; log: (message: string) => void }): Promise<Session> {
  const root = path.resolve('src/batch/harness'), outDir = path.resolve('work/motion-tool/harness');
  options.log('처리 페이지 빌드 중');
  await build({ configFile: false, root, base: './', logLevel: 'warn', worker: { format: 'es' }, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 4000 } });
  const server = await preview({ configFile: false, root, base: './', logLevel: 'warn', build: { outDir }, preview: { host: '127.0.0.1', port: 4190, strictPort: false, open: false } });
  const address = server.resolvedUrls?.local[0];
  if (!address) { await server.close(); throw new Error('처리 페이지 서버 주소를 확인하지 못했습니다.'); }
  const origin = new URL(address).origin;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), ...(options.channel ? { channel: options.channel } : {}) });
  } catch (error) {
    await server.close();
    throw new Error(`Chromium을 시작하지 못했습니다. 'npx playwright install chromium'을 실행하거나 CHROMIUM_PATH 또는 --channel chrome을 지정하세요.\n${error instanceof Error ? error.message : String(error)}`);
  }
  const context = await browser.newContext();
  const blocked: string[] = [];
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (url === MODELS.pose || url === MODELS.hand) {
      return route.fulfill({ body: await readFile(options.models[url === MODELS.pose ? 'pose' : 'hand']), contentType: 'application/octet-stream', headers: CORS });
    }
    if (url.startsWith(MODELS.wasm + '/')) {
      const name = path.basename(new URL(url).pathname);
      return route.fulfill({ body: await readFile(path.join(options.wasmDir, name)), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: CORS });
    }
    blocked.push(url);
    return route.abort('blockedbyclient');
  });
  return {
    browser: `${browser.browserType().name()} ${browser.version()}`,
    blocked,
    async process(video, run) {
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.exposeFunction('signlingoProgress', (p: { phase: string; done: number; total: number }) => {
          options.log(`  ${p.phase}${p.total ? ` ${Math.round(p.done * 100 / p.total)}%` : ''}`);
        });
        await page.goto(address);
        await page.waitForFunction(() => !!window.signlingoBatch);
        await page.setInputFiles('#video', path.resolve(video));
        return await page.evaluate(options => window.signlingoBatch.run(options), run);
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0] : String(error);
        throw new Error(errors.length ? `${message} (페이지 오류: ${errors.join('; ')})` : message);
      } finally { await page.close(); }
    },
    async close() { await context.close(); await browser.close(); await server.close(); },
  };
}
