import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import catalog from '../src/content/catalog.json';
import { approvedFixture } from './content-fixtures';
import { reviewSubject, sha256 } from '../src/content/validation';
import { expressionSchema } from '../src/content/schema';

const bundle = path.resolve('work/content-cli-tests/cli.mjs');
// Run the release flow on a candidate that is not yet published; published entries are immutable.
const ID = catalog.expressions.find(entry => entry.status === 'rights-review-required')!.id;
const unpublished = { ...catalog, expressions: catalog.expressions.filter(entry => entry.status !== 'published') };
let root: string;
beforeAll(async () => {
  await build({ configFile: false, logLevel: 'silent', build: { ssr: 'src/content/cli.ts', outDir: 'work/content-cli-tests', emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'cli.mjs' } } } });
  root = await mkdtemp(path.join(os.tmpdir(), 'signlingo-release-'));
  for (const directory of ['src/content', 'public/content', 'docs/content-reviews', 'private-data']) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, 'src/content/catalog.json'), JSON.stringify(unpublished));
  await writeFile(path.join(root, 'public/content/releases.json'), '[]');
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
function command(...args: string[]) {
  return execFileSync(process.execPath, [bundle, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}
const readEntry = async () => expressionSchema.parse(JSON.parse(await readFile(path.join(root, `private-data/${ID}/entry.json`), 'utf8')));
const saveEntry = async (value: unknown) => writeFile(path.join(root, `private-data/${ID}/entry.json`), JSON.stringify(value));

it('registers, prepares, inspects, independently reviews and packages without copying an original video', async () => {
  const fixture = await approvedFixture(ID);
  command('register', ID, `private-data/${ID}`);
  expect(() => command('publish', `private-data/${ID}`)).toThrow();
  let entry = await readEntry();
  const video = new TextEncoder().encode('CONTRACT TEST ONLY — not video or KSL');
  entry = { ...fixture.entry, status: 'rights-review-required', assets: {}, reconstructionVersion: null,
    reviews: { reconstruction: { status: 'pending' }, linguistic: { status: 'pending' } } };
  entry.source.videoSha256 = await sha256(video); entry.license.approval!.sourceSha256 = entry.source.videoSha256;
  await writeFile(path.join(root, 'docs/content-reviews/contract-test.md'), fixture.document);
  await saveEntry(entry);
  await writeFile(path.join(root, 'private-data/contract-camera.mp4'), video);
  fixture.clip.source.size = video.length;
  await writeFile(path.join(root, 'private-data/export.motion.json'), JSON.stringify(fixture.clip));
  command('transition', `private-data/${ID}/entry.json`, 'source-approved');
  command('transition', `private-data/${ID}/entry.json`, 'motion-processing-required');
  command('prepare', `private-data/${ID}`, 'private-data/contract-camera.mp4', 'private-data/export.motion.json');
  const inspection = JSON.parse(await readFile(path.join(root, `private-data/${ID}/inspection.json`), 'utf8'));
  expect(inspection.frames).toBeGreaterThan(2); expect(inspection.missingHands).toHaveProperty('left');
  expect(() => command('transition', `private-data/${ID}/entry.json`, 'linguistic-review-required')).toThrow();
  entry = await readEntry();
  entry.reviews.reconstruction = { ...fixture.entry.reviews.reconstruction, subjectSha256: await reviewSubject(entry) };
  await saveEntry(entry); command('transition', `private-data/${ID}/entry.json`, 'linguistic-review-required');
  expect(() => command('transition', `private-data/${ID}/entry.json`, 'ready-to-publish')).toThrow();
  entry = await readEntry(); entry.reviews.linguistic = { ...fixture.entry.reviews.linguistic, subjectSha256: await reviewSubject(entry) };
  await saveEntry(entry); command('transition', `private-data/${ID}/entry.json`, 'ready-to-publish');
  command('publish', `private-data/${ID}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'public/content/manifest.json'), 'utf8'));
  expect(manifest.expressions[0].status).toBe('published');
  expect(manifest.expressions[0].assets.video).toBeUndefined();
  expect(await readFile(path.join(root, 'public', entry.assets.motion!.uri), 'utf8')).toBe(JSON.stringify(fixture.clip));
  expect(() => command('publish', `private-data/${ID}`)).toThrow();
}, 15000);
