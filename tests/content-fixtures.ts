/** Contract fixtures only. These are synthetic and never copied to public/ or bundled with the app. */
import catalog from '../src/content/catalog.json' with { type: 'json' };
import { expressionSchema, type Catalog, type Expression } from '../src/content/schema';
import { reviewSubject, sha256 } from '../src/content/validation';
import { practiceClip } from './practice-fixtures';
import type { MotionClip } from '../src/motion/types';

export async function approvedFixture(id = catalog.expressions[0].id) {
  const entry = expressionSchema.parse(structuredClone(catalog.expressions.find(item => item.id === id)!));
  // Simulate metadata of an authorized camera import to exercise the release contract.
  // This metadata is deliberately fictional; geometry remains synthetic test data.
  const clip = practiceClip(); clip.source.name = 'contract-camera.mp4'; clip.pipeline.detector = 'contract-camera-import';
  const bytes = new TextEncoder().encode(JSON.stringify(clip));
  const document = new TextEncoder().encode('TEST ONLY: simulated evidence; not a KSL approval.');
  const documentHash = await sha256(document);
  const evidence = { reviewer: '테스트 검수자', qualification: '테스트 전용', date: '2026-10-13', reference: '계약 테스트 기록',
    notes: '실제 허락 또는 검수 아님', document: { path: 'docs/content-reviews/contract-test.md', sha256: documentHash } };
  entry.source.videoSha256 = 'a'.repeat(64); entry.source.entryId = 'contract-test';
  entry.license.type = '테스트 전용 허락 (실제 이용 허락 아님)';
  entry.license.approval = { ...evidence, sourceSha256: entry.source.videoSha256 };
  for (const key of Object.keys(entry.license.permissions) as (keyof Expression['license']['permissions'])[]) entry.license.permissions[key] = 'allowed';
  entry.variant = { id: 'contract-test', status: 'identified', description: '테스트 전용' };
  entry.provenance = 'authorized-video'; entry.reconstructionVersion = clip.pipeline.version;
  entry.difficulty.cameraSuitability = 'suitable'; entry.movementNotes = ['테스트 화면 동작만 확인합니다. 한국수어가 아닙니다.'];
  entry.assets.motion = { uri: `content/assets/${entry.id}/v1/reference.motion.json`, sha256: await sha256(bytes), bytes: bytes.length, mediaType: 'application/json', version: 1 };
  entry.status = 'published';
  const subjectSha256 = await reviewSubject(entry);
  entry.reviews = { reconstruction: { status: 'approved', evidence, subjectSha256 }, linguistic: { status: 'approved', evidence, subjectSha256 } };
  const manifest: Catalog = { schema: 'signlingo.content', version: 1, updatedAt: '2026-10-13', lessons: catalog.lessons, expressions: [entry] };
  return { entry, clip, bytes, document, manifest };
}

/**
 * Several approved entries for learning-path browser tests. Each gets distinct synthetic motion,
 * source entry and variant identifiers so recognition questions can be built. Test-only data.
 */
export async function approvedCatalogFixture(ids = ['ksl-thanks', 'ksl-okay', 'ksl-no', 'ksl-what']) {
  const variants: Parameters<typeof practiceClip>[0][] = [{}, { swap: true }, { lift: -.8 }, { idle: true, swap: true }];
  const document = new TextEncoder().encode('TEST ONLY: simulated evidence; not a KSL approval.');
  const evidence = { reviewer: '테스트 검수자', qualification: '테스트 전용', date: '2026-10-13', reference: '계약 테스트 기록',
    notes: '실제 허락 또는 검수 아님', document: { path: 'docs/content-reviews/contract-test.md', sha256: await sha256(document) } };
  const entries: Expression[] = [], clips: MotionClip[] = [], assets = new Map<string, Uint8Array>();
  for (const [i, id] of ids.entries()) {
    const entry = expressionSchema.parse(structuredClone(catalog.expressions.find(e => e.id === id)));
    const clip = practiceClip(variants[i % variants.length]); clip.source.name = `contract-camera-${i}.mp4`; clip.pipeline.detector = 'contract-camera-import';
    const bytes = new TextEncoder().encode(JSON.stringify(clip));
    entry.source.videoSha256 = String(i + 1).repeat(64).slice(0, 64); entry.source.entryId = `contract-test-${id}`;
    entry.license.type = '테스트 전용 허락 (실제 이용 허락 아님)';
    entry.license.approval = { ...evidence, sourceSha256: entry.source.videoSha256 };
    for (const key of Object.keys(entry.license.permissions) as (keyof Expression['license']['permissions'])[]) entry.license.permissions[key] = 'allowed';
    entry.variant = { id: `contract-test-${id}`, status: 'identified', description: '테스트 전용' };
    entry.provenance = 'authorized-video'; entry.reconstructionVersion = clip.pipeline.version;
    entry.difficulty.cameraSuitability = 'suitable'; entry.movementNotes = ['테스트 화면 동작만 확인합니다. 한국수어가 아닙니다.'];
    entry.assets.motion = { uri: `content/assets/${entry.id}/v1/reference.motion.json`, sha256: await sha256(bytes), bytes: bytes.length, mediaType: 'application/json', version: 1 };
    entry.status = 'published';
    const subjectSha256 = await reviewSubject(entry);
    entry.reviews = { reconstruction: { status: 'approved', evidence, subjectSha256 }, linguistic: { status: 'approved', evidence, subjectSha256 } };
    entries.push(entry); clips.push(clip); assets.set(entry.assets.motion.uri, bytes);
  }
  const manifest: Catalog = { schema: 'signlingo.content', version: 1, updatedAt: '2026-10-13', lessons: catalog.lessons, expressions: entries };
  return { entries, clips, assets, manifest };
}
