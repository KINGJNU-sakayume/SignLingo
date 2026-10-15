import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import catalog from '../src/content/catalog.json';
import { approvedFixture } from './content-fixtures';
import { reviewSubject, sha256, verifyReviews } from '../src/content/validation';
import { importMotion } from '../src/motion/serialization';
import { parseConstraints } from '../src/motion/constraints';
import { expressionSchema } from '../src/content/schema';
import { releaseDate } from '../src/content/package';

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
/** Runs a command expected to fail and returns its error output. */
function failure(...args: string[]) {
  try { execFileSync(process.execPath, [bundle, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { return String((error as { stderr?: string }).stderr); }
  throw new Error(`Expected failure: ${args.join(' ')}`);
}
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=contract-test', '-c', 'user.email=contract-test@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
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
  const published = JSON.parse(await readFile(path.join(root, 'src/content/catalog.json'), 'utf8'));
  expect(manifest.expressions[0].status).toBe('published');
  // The release date moves forward with each publish, in the catalog and its generated manifest alike.
  expect(published.updatedAt).toBe(releaseDate(new Date(), entry.updatedAt, unpublished.updatedAt));
  expect(manifest.updatedAt).toBe(published.updatedAt);
  expect(published.updatedAt >= entry.updatedAt && published.updatedAt >= unpublished.updatedAt).toBe(true);
  expect(manifest.expressions[0].assets.video).toBeUndefined();
  expect(await readFile(path.join(root, 'public', entry.assets.motion!.uri), 'utf8')).toBe(JSON.stringify(fixture.clip));
  expect(() => command('publish', `private-data/${ID}`)).toThrow();

  // CI's compatibility check compares published entries with the base commit; a newer top-level date passes.
  const older = (value: { updatedAt: string }) => JSON.stringify({ ...value, updatedAt: '2026-01-01' }, null, 2) + '\n';
  const current = { catalog: await readFile(path.join(root, 'src/content/catalog.json'), 'utf8'), manifest: await readFile(path.join(root, 'public/content/manifest.json'), 'utf8') };
  await writeFile(path.join(root, 'src/content/catalog.json'), older(JSON.parse(current.catalog)));
  await writeFile(path.join(root, 'public/content/manifest.json'), older(JSON.parse(current.manifest)));
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base release');
  await writeFile(path.join(root, 'src/content/catalog.json'), current.catalog);
  await writeFile(path.join(root, 'public/content/manifest.json'), current.manifest);
  expect(execFileSync(process.execPath, [bundle, 'validate'], { cwd: root, encoding: 'utf8', env: { ...process.env, CONTENT_BASE_REF: 'HEAD' } })).toContain('콘텐츠 검증 완료');
}, 30000);

it('constrains a published package into a new private revision, resets reviews and never touches public/', async () => {
  const before = await readEntry();
  const fixture = await approvedFixture(ID);
  const files = async () => Object.fromEntries(await Promise.all((await readdir(path.join(root, 'public'), { recursive: true, withFileTypes: true }))
    .filter(f => f.isFile()).map(async f => { const file = path.join(f.parentPath, f.name); return [file, await sha256(await readFile(file))] as const; })));
  const publicBefore = await files();
  const constraints = { format: 'signlingo.constraints', version: 1, expression: ID, constraints: [
    { id: 'left-flat', kind: 'handshape', span: { frames: [0, 12] }, blendMs: 0, hand: 'left', preset: 'flat', note: '왼손 편손 (계약 테스트)' },
    { id: 'turn', kind: 'wristOffset', span: { frames: [14, 18] }, blendMs: 0, hand: 'right', degrees: [10, 0, 0], note: '오른손목 10도 (계약 테스트)' },
  ] };
  await writeFile(path.join(root, 'private-data/fix.constraints.json'), JSON.stringify(constraints));
  expect(command('constrain', `private-data/${ID}`, 'private-data/fix.constraints.json')).toContain('revision 2');
  const entry = await readEntry();
  expect(entry.revision).toBe(2);
  expect(entry.status).toBe('reconstruction-review-required');
  expect(entry.reviews).toEqual({ reconstruction: { status: 'pending' }, linguistic: { status: 'pending' } });
  expect(entry.license.approval).toEqual(before.license.approval);
  expect([entry.description, entry.variant, entry.movementNotes]).toEqual([before.description, before.variant, before.movementNotes]);
  expect(entry.assets.motion).toMatchObject({ uri: `content/assets/${ID}/v2/reference.motion.json`, version: 2 });
  const motion = await readFile(path.join(root, `private-data/${ID}`, entry.assets.motion!.uri));
  const clip = importMotion(motion.toString());
  expect(clip.version).toBe(2);
  expect(entry.constraints).toEqual({ sha256: clip.constraints!.sha256, count: 2 });
  expect(parseConstraints(await readFile(path.join(root, `private-data/${ID}/constraints.json`), 'utf8'))).toEqual(clip.constraints!.document);
  const inspection = JSON.parse(await readFile(path.join(root, `private-data/${ID}/inspection.json`), 'utf8'));
  expect(inspection).toMatchObject({ revision: 2, constraints: { sha256: clip.constraints!.sha256, count: 2 } });
  expect(inspection.constraints.changedFrames).toBeGreaterThan(10);
  // The subject changed, so approvals of the published revision no longer verify.
  await expect(verifyReviews({ ...entry, reviews: before.reviews })).rejects.toThrow('검수');
  expect(await reviewSubject(entry)).not.toBe(before.reviews.reconstruction.subjectSha256);
  // Re-running from the corrected package stays at revision 2 and rebuilds the same file.
  command('constrain', `private-data/${ID}`, 'private-data/fix.constraints.json');
  expect((await readEntry()).revision).toBe(2);
  expect(await readFile(path.join(root, `private-data/${ID}`, entry.assets.motion!.uri))).toEqual(motion);
  expect(await files()).toEqual(publicBefore);
  // A constraint document for another expression is refused.
  await writeFile(path.join(root, 'private-data/other.constraints.json'), JSON.stringify({ ...constraints, expression: 'ksl-other' }));
  expect(failure('constrain', `private-data/${ID}`, 'private-data/other.constraints.json')).toContain('ksl-other');
  // Publishing a corrected package at the published revision is refused.
  const stale = { ...before, status: 'ready-to-publish' as const };
  await saveEntry(stale);
  expect(failure('publish', `private-data/${ID}`)).toContain('Published revisions are immutable');
  await saveEntry(entry);
  expect(fixture.entry.id).toBe(ID);
}, 30000);
