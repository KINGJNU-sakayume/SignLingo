/**
 * DEVELOPMENT ONLY: reviewer preview of unpublished packages in the ignored private-data/ folder.
 * Loaded through a dynamic import guarded by import.meta.env.DEV in Shell.tsx (`?review=1`).
 * Lets the rights holder and reviewers see the exact package motion (and the private original video)
 * in the learner screens before approval. It never changes a package status, never writes to public/
 * and is excluded from production builds (see scripts/check-dist.mjs).
 */
import type { ContentSource } from '../learn/source';
import type { Catalog, Expression } from '../content/schema';
import { catalogSchema, expressionSchema, STATES } from '../content/schema';
import { parseLessonMotion, verifyAsset } from '../content/assets';
import { sha256 } from '../content/validation';
import catalogJson from '../content/catalog.json';

export const REVIEW_MARKER = 'SIGNLINGO_REVIEW_PREVIEW';
const entries = import.meta.glob<unknown>('/private-data/*/entry.json', { import: 'default' });
const motions = import.meta.glob<string>('/private-data/*/content/assets/*/v*/*.motion.json', { query: '?url', import: 'default' });
const videos = import.meta.glob<string>('/private-data/videos/*.{webm,mp4}', { query: '?url', import: 'default' });
const REVIEWABLE = STATES.indexOf('reconstruction-review-required');

async function loadPackages(): Promise<Expression[]> {
  const loaded: Expression[] = [];
  for (const load of Object.values(entries)) {
    const parsed = expressionSchema.safeParse(await load());
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (STATES.indexOf(entry.status) >= REVIEWABLE && entry.assets.motion) loaded.push(entry);
  }
  return loaded;
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('검수 패키지 파일을 불러오지 못했습니다.');
  return new Uint8Array(await response.arrayBuffer());
}

export const reviewSource: ContentSource = {
  kind: 'demo',
  banner: '검수용 미리보기 · 공개 전 콘텐츠 (언어 검수 전)',
  // Separate keys so preview sessions never mix with real learning records.
  storage: { progress: 'signlingo.review.progress.v1', learn: 'signlingo.review.learn.v2' },
  async loadCatalog() {
    const base = catalogSchema.parse(catalogJson);
    const packages = await loadPackages();
    const lessonIds = new Set(packages.map(entry => entry.lessonId));
    const catalog: Catalog = { ...base, lessons: base.lessons.filter(lesson => lessonIds.has(lesson.id)), expressions: packages };
    return catalog;
  },
  async loadMotion(entry, signal) {
    const asset = entry.assets.motion;
    const key = Object.keys(motions).find(path => path.startsWith(`/private-data/${entry.id}/`) && asset && path.endsWith(asset.uri));
    if (!asset || !key) throw new Error('검수 패키지에 동작 파일이 없습니다.');
    const bytes = await fetchBytes(await motions[key](), signal);
    await verifyAsset(asset, bytes);
    return parseLessonMotion(entry, bytes);
  },
  async loadVideo(entry, signal) {
    const key = Object.keys(videos).find(path => path.endsWith(`/${entry.source.locator}`));
    if (!key) return null;
    const bytes = await fetchBytes(await videos[key](), signal);
    if (await sha256(bytes) !== entry.source.videoSha256) throw new Error('원본 영상이 이용 허락 기록과 다릅니다.');
    return new Blob([bytes], { type: key.endsWith('.mp4') ? 'video/mp4' : 'video/webm' });
  },
};
