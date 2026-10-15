import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import catalog from '../src/content/catalog.json';
import manifest from '../public/content/manifest.json';
import { expressionSchema, assetSchema } from '../src/content/schema';
import { parseCatalog, reviewSubject, sha256, transition, verifyReviews } from '../src/content/validation';
import { assetUrl, loadLessonMotion, parseLessonMotion, verifyAsset } from '../src/content/assets';
import { publicManifest, readContained, releaseDate, validatePackage, validatePublic, verifyCompatibility } from '../src/content/package';
import { approvedFixture } from './content-fixtures';
import { practiceClip } from './practice-fixtures';
import { applyConstraints, parseConstraints } from '../src/motion/constraints';

const temporary: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function packageFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'signlingo-content-')); temporary.push(root);
  const fixture = await approvedFixture();
  const file = path.join(root, fixture.entry.assets.motion!.uri);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, fixture.bytes);
  await mkdir(path.join(root, 'docs/content-reviews'), { recursive: true });
  await writeFile(path.join(root, 'docs/content-reviews/contract-test.md'), fixture.document);
  return { root, file, ...fixture };
}
describe('content release contract', () => {
  it('publishes only the reviewed course-1 expressions and keeps the other candidates internal', () => {
    const parsed = parseCatalog(catalog);
    expect(parsed.expressions).toHaveLength(10);
    const published = parsed.expressions.filter(entry => entry.status === 'published');
    expect(published.map(entry => entry.id)).toEqual(['ksl-thanks', 'ksl-sorry', 'ksl-meet']);
    expect(published.every(entry => entry.lessonId === 'courtesy' && entry.assets.motion && !entry.assets.video && entry.provenance === 'authorized-video')).toBe(true);
    expect(parsed.expressions.filter(entry => entry.status !== 'published').every(entry => entry.status === 'rights-review-required' && !entry.assets.motion && entry.gloss === null)).toBe(true);
    expect(manifest).toEqual(publicManifest(parsed)); expect(manifest.expressions.map(entry => entry.id)).toEqual(['ksl-thanks', 'ksl-sorry', 'ksl-meet']);
  });
  it('rejects duplicate IDs, missing lessons, unsupported schema and incomplete attribution/license metadata', () => {
    expect(() => parseCatalog({ ...catalog, expressions: [catalog.expressions[0], catalog.expressions[0]] })).toThrow('중복');
    expect(() => parseCatalog({ ...catalog, lessons: [] })).toThrow('없는 레슨');
    expect(() => parseCatalog({ ...catalog, version: 2 })).toThrow();
    for (const mutate of [(entry: any) => entry.source.attribution = ' ', (entry: any) => delete entry.license.policyUrl, (entry: any) => delete entry.license.permissions.deriveMotion]) {
      const entry = structuredClone(catalog.expressions[0]); mutate(entry); expect(() => expressionSchema.parse(entry)).toThrow();
    }
  });
  it('rejects setting published or ready flags without evidence and forbids skipped transitions', () => {
    const candidate = catalog.expressions.find(entry => entry.status === 'rights-review-required')!;
    for (const status of ['source-approved', 'ready-to-publish', 'published']) expect(() => parseCatalog({ ...catalog, expressions: [{ ...candidate, status }] })).toThrow();
    expect(() => transition(expressionSchema.parse(candidate), 'published')).toThrow('순서');
  });
  it('requires separate reconstruction and linguistic review and rights for each distribution scope', async () => {
    const { entry, manifest } = await approvedFixture();
    for (const kind of ['reconstruction', 'linguistic'] as const) {
      const changed = structuredClone(entry); changed.reviews[kind] = { status: 'pending' };
      expect(() => parseCatalog({ ...manifest, expressions: [changed] })).toThrow();
    }
    for (const key of ['deriveMotion', 'publishMotion', 'publicRepository', 'publicWebsite'] as const) {
      const changed = structuredClone(entry); changed.license.permissions[key] = 'unknown';
      expect(() => parseCatalog({ ...manifest, expressions: [changed] })).toThrow();
    }
    const staged = { ...entry, status: 'reconstruction-review-required' as const };
    expect(transition(transition(transition(staged, 'linguistic-review-required'), 'ready-to-publish'), 'published').status).toBe('published');
  });
  it('invalidates approval when educational text, source, rights, variant, motion or version changes', async () => {
    const { entry } = await approvedFixture(); await verifyReviews(entry);
    for (const mutate of [(e: typeof entry) => e.meaning += '수정', (e: typeof entry) => e.variant.id = 'changed',
      (e: typeof entry) => e.license.notes += '수정', (e: typeof entry) => e.source.videoSha256 = 'b'.repeat(64),
      (e: typeof entry) => e.assets.motion!.sha256 = 'b'.repeat(64), (e: typeof entry) => e.reconstructionVersion = '99']) {
      const changed = structuredClone(entry); mutate(changed); await expect(verifyReviews(changed)).rejects.toThrow('검수');
    }
  });
  it('validates real bytes, MotionClip v1 timestamps, rig data and preserved older pipeline versions', async () => {
    const { entry, bytes, clip } = await approvedFixture();
    await verifyAsset(entry.assets.motion!, bytes); expect(parseLessonMotion(entry, bytes).version).toBe(1);
    await expect(verifyAsset(entry.assets.motion!, bytes.slice(1))).rejects.toThrow('무결성');
    clip.frames[1].timestamp = 0;
    expect(() => parseLessonMotion(entry, new TextEncoder().encode(JSON.stringify(clip)))).toThrow();
    const legacy = practiceClip(); legacy.source.name = 'old-camera.mp4'; legacy.pipeline.detector = 'camera'; legacy.pipeline.version = '0.1.0';
    expect(parseLessonMotion({ ...entry, reconstructionVersion: '0.1.0' }, new TextEncoder().encode(JSON.stringify(legacy))).pipeline.version).toBe('0.1.0');
    expect(() => parseLessonMotion(entry, new TextEncoder().encode(JSON.stringify(practiceClip())))).toThrow('합성');
  });
  it('reads a constraint-corrected (version-2) motion only when the entry records the same constraint hash', async () => {
    const { entry, clip } = await approvedFixture();
    const set = parseConstraints({ format: 'signlingo.constraints', version: 1, constraints: [{ id: 'shape', kind: 'handshape', span: { frames: [0, 10] }, hand: 'left', preset: 'flat', note: '왼손 편손 (계약 테스트)' }] });
    const { clip: corrected } = await applyConstraints(clip, set);
    const bytes = new TextEncoder().encode(JSON.stringify(corrected));
    const recorded = { ...entry, constraints: { sha256: corrected.constraints!.sha256, count: 1 } };
    expect(parseLessonMotion(recorded, bytes).version).toBe(2);
    expect(() => parseLessonMotion(entry, bytes)).toThrow('제약 조건');
    expect(() => parseLessonMotion({ ...entry, constraints: { sha256: 'b'.repeat(64), count: 1 } }, bytes)).toThrow('제약 조건');
    expect(() => parseLessonMotion(recorded, new TextEncoder().encode(JSON.stringify(clip)))).toThrow('제약 조건');
    // The constraint hash is part of the review subject: correcting the motion invalidates approvals.
    expect(await reviewSubject(recorded)).not.toBe(await reviewSubject(entry));
    await expect(verifyReviews(recorded)).rejects.toThrow('검수');
  });
  it('rejects missing assets, missing/altered evidence documents and unregistered public media', async () => {
    const fixture = await packageFixture();
    await validatePackage(fixture.manifest, fixture.root, false, fixture.root);
    await writeFile(path.join(fixture.root, 'content/secret-video.mp4'), 'private');
    await expect(validatePublic(fixture.manifest, fixture.root, [], fixture.root)).rejects.toThrow('Unapproved');
    await rm(fixture.file); await expect(validatePackage(fixture.manifest, fixture.root, false, fixture.root)).rejects.toThrow();
    await writeFile(fixture.file, fixture.bytes);
    await writeFile(path.join(fixture.root, 'docs/content-reviews/contract-test.md'), 'modified evidence');
    await expect(validatePackage(fixture.manifest, fixture.root, false, fixture.root)).rejects.toThrow('evidence');
  });
  it('rejects unsafe asset paths and symbolic links escaping the private package', async () => {
    for (const uri of ['../private.mp4', '/content/test.json', 'javascript:alert(1)', 'https://user:pass@example.org/a.mp4', 'content/assets/test/v1/../x']) {
      const { entry } = await approvedFixture(); expect(() => assetSchema.parse({ ...entry.assets.motion, uri })).toThrow();
    }
    const { root } = await packageFixture(); await symlink('/etc/passwd', path.join(root, 'escape'));
    await expect(readContained(root, 'escape')).rejects.toThrow('escapes');
  });
  it('retains immutable published revisions and verifies archived assets too', async () => {
    const { entry, root, file, manifest } = await packageFixture();
    verifyCompatibility([entry], [entry]); expect(() => verifyCompatibility([entry], [])).toThrow('removed');
    expect(() => verifyCompatibility([entry], [{ ...entry, meaning: 'changed' }])).toThrow('modified');
    const empty = { ...manifest, expressions: [] };
    await validatePublic(empty, root, [entry], root);
    await rm(file); await expect(validatePublic(empty, root, [entry], root)).rejects.toThrow();
  });
  it('treats the top-level release date as release metadata, not as a published revision', async () => {
    const { entry, manifest } = await approvedFixture();
    const next = { ...manifest, updatedAt: '2026-10-14' };
    // validate compares only entries with the base; the manifest must still equal the catalog it came from.
    expect(() => verifyCompatibility(manifest.expressions, next.expressions)).not.toThrow();
    expect(publicManifest(next).updatedAt).toBe('2026-10-14');
    expect(() => verifyCompatibility([entry], [{ ...entry, updatedAt: '2026-12-31' }])).toThrow('modified');
    expect(releaseDate(new Date(2026, 9, 14, 8), '2026-10-13')).toBe('2026-10-14');
    expect(releaseDate(new Date(2026, 9, 14, 8), '2026-10-15', '2026-10-13')).toBe('2026-10-15');
  });
  it('loads approved lessons using the existing parser, checks digests, and handles network failure', async () => {
    const { entry, bytes } = await approvedFixture();
    vi.stubGlobal('document', { baseURI: 'https://example.org/SignLingo/' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    expect(assetUrl(entry.assets.motion!.uri, 'https://example.org/SignLingo/')).toContain('/SignLingo/content/assets/');
    expect((await loadLessonMotion(entry)).frames.length).toBeGreaterThan(2);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    await expect(loadLessonMotion(entry)).rejects.toThrow('불러오지');
    entry.status = 'candidate'; await expect(loadLessonMotion(entry)).rejects.toThrow('공개되지');
  });
  it('requires explicit external video permission even with a permitted motion asset', async () => {
    const { entry, manifest } = await approvedFixture();
    entry.assets.video = { uri: 'https://media.example.org/v1/video.mp4', sha256: entry.source.videoSha256!, bytes: 100, version: 1, mediaType: 'video/mp4' };
    entry.license.permissions.externalVideo = 'unknown';
    expect(() => parseCatalog({ ...manifest, expressions: [entry] })).toThrow('표시 또는 배포 허락');
  });
});
