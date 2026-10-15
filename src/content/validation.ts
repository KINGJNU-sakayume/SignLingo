import { catalogSchema, expressionSchema, STATES, type Catalog, type ContentState, type Expression } from './schema';
import { canonicalSha256, sha256 } from '../motion/canonical';
export { sha256 };

/** Status is a claim; evidence is checked independently at every entry point. */
export function stateErrors(entry: Expression): string[] {
  const errors: string[] = [];
  const rank = STATES.indexOf(entry.status);
  const permissions = entry.license.permissions;
  if (rank >= 2) {
    if (permissions.importVideo !== 'allowed' || permissions.deriveMotion !== 'allowed') errors.push('원본 가져오기와 3D 변환 허락이 필요합니다.');
    if (!entry.license.approval || !entry.source.videoSha256 || entry.license.approval.sourceSha256 !== entry.source.videoSha256) errors.push('원본 해시와 일치하는 이용 허락 근거가 필요합니다.');
    if (entry.provenance !== 'authorized-video') errors.push('사용이 허락된 실사 영상이 필요합니다.');
  }
  if (rank >= 4 && (!entry.assets.motion || !entry.reconstructionVersion)) errors.push('복원 버전과 동작 파일이 필요합니다.');
  if (rank >= 5 && !approved(entry.reviews.reconstruction)) errors.push('3D 복원 검수 근거가 필요합니다.');
  if (rank >= 6) {
    if (!approved(entry.reviews.linguistic)) errors.push('한국수어 전문가의 검수 근거가 필요합니다.');
    if (!entry.source.entryId || entry.variant.status !== 'identified' || !entry.variant.id) errors.push('원본 항목과 표현 변이 식별자가 필요합니다.');
    if (entry.difficulty.cameraSuitability !== 'suitable' || !entry.movementNotes.length) errors.push('카메라 연습 적합성 검토와 동작 유의사항이 필요합니다.');
    if (['publishMotion', 'publicRepository', 'publicWebsite'].some(key => permissions[key as keyof typeof permissions] !== 'allowed')) errors.push('동작 파일·공개 저장소·웹사이트 배포 허락이 필요합니다.');
  }
  if (entry.assets.motion?.mediaType !== undefined && entry.assets.motion.mediaType !== 'application/json') errors.push('동작 자산은 JSON이어야 합니다.');
  for (const asset of Object.values(entry.assets)) {
    if (asset.version !== entry.revision || (!asset.uri.startsWith('https://') && !asset.uri.startsWith(`content/assets/${entry.id}/v${entry.revision}/`))) errors.push('자산 경로와 콘텐츠 버전이 일치해야 합니다.');
  }
  if (entry.assets.video) {
    if (!entry.assets.video.mediaType.startsWith('video/')) errors.push('원본 자산은 영상이어야 합니다.');
    if (entry.assets.video.sha256 !== entry.source.videoSha256) errors.push('영상 자산과 승인된 원본의 해시가 다릅니다.');
    const permission = entry.assets.video.uri.startsWith('https://') ? permissions.externalVideo : permissions.publishVideo;
    if (permission !== 'allowed') errors.push('원본 영상의 표시 또는 배포 허락이 필요합니다.');
  }
  return errors;
}
function approved(review: Expression['reviews']['linguistic']) {
  return review.status === 'approved' && !!review.evidence && !!review.subjectSha256;
}
export function parseCatalog(value: unknown): Catalog {
  const catalog = catalogSchema.parse(value);
  const seen = new Set<string>();
  for (const lesson of catalog.lessons) {
    if (seen.has(lesson.id)) throw new Error(`중복 레슨 ID: ${lesson.id}`);
    seen.add(lesson.id);
  }
  const ids = new Set<string>();
  for (const entry of catalog.expressions) {
    if (ids.has(entry.id)) throw new Error(`중복 표현 ID: ${entry.id}`);
    ids.add(entry.id);
    if (!seen.has(entry.lessonId)) throw new Error(`없는 레슨 참조: ${entry.id}`);
    const errors = stateErrors(entry);
    if (errors.length) throw new Error(`${entry.id}: ${errors.join(' ')}`);
  }
  return catalog;
}
export function transition(entry: Expression, next: ContentState): Expression {
  if (next !== 'rights-review-required' && STATES.indexOf(next) !== STATES.indexOf(entry.status) + 1) throw new Error('검수 단계를 순서대로 진행하세요.');
  const updated = expressionSchema.parse({ ...entry, status: next });
  const errors = stateErrors(updated);
  if (errors.length) throw new Error(errors.join(' '));
  return updated;
}
export function isPublished(entry: Expression) { return entry.status === 'published' && stateErrors(entry).length === 0; }

/**
 * Includes rights, variant, text, pipeline, source, asset bytes and applied motion constraints; excludes only
 * review/workflow bookkeeping. Constraint correction therefore invalidates every earlier approval.
 */
export async function reviewSubject(entry: Expression) {
  const { reviews: _reviews, status: _status, updatedAt: _updated, ...subject } = expressionSchema.parse(entry);
  return canonicalSha256(subject);
}
export async function verifyReviews(entry: Expression) {
  const subject = await reviewSubject(entry);
  for (const review of Object.values(entry.reviews)) {
    if (review.status === 'approved' && (!review.evidence || review.subjectSha256 !== subject)) throw new Error('검수 근거가 현재 콘텐츠와 다릅니다. 수정 후 다시 검수하세요.');
  }
}
