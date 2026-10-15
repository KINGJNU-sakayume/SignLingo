import { importMotion } from '../motion/serialization';
import { sha256, stateErrors, verifyReviews } from './validation';
import type { Asset, Expression } from './schema';

export function assetUrl(uri: string, base = new URL(import.meta.env.BASE_URL, document.baseURI).href) {
  return new URL(uri, base).href;
}
export async function verifyAsset(asset: Asset, bytes: Uint8Array) {
  if (bytes.byteLength !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Error('학습 자료의 무결성을 확인하지 못했습니다.');
}
export function parseLessonMotion(entry: Expression, bytes: Uint8Array) {
  const clip = importMotion(new TextDecoder().decode(bytes));
  if (clip.frames.length < 3 || clip.pipeline.version !== entry.reconstructionVersion) throw new Error('동작 프레임 또는 복원 버전이 올바르지 않습니다.');
  if (/synthetic|fixture|not-ksl/i.test(clip.pipeline.detector + ' ' + clip.source.name) || entry.provenance === 'synthetic-test') throw new Error('합성 테스트 동작은 학습 콘텐츠로 공개할 수 없습니다.');
  // A corrected (version-2) motion must be the one the entry, and so its reviews, records.
  const recorded = clip.constraints ? { sha256: clip.constraints.sha256, count: clip.constraints.document.constraints.length } : undefined;
  if (recorded?.sha256 !== entry.constraints?.sha256 || recorded?.count !== entry.constraints?.count) throw new Error('동작 파일의 제약 조건 기록이 콘텐츠 정보와 다릅니다.');
  return clip;
}
export async function fetchAsset(asset: Asset, signal?: AbortSignal) {
  const response = await fetch(assetUrl(asset.uri), { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('학습 자료를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('학습 자료를 읽을 수 없습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > asset.bytes) throw new Error('학습 자료의 크기가 등록 정보와 다릅니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  await verifyAsset(asset, bytes);
  return bytes;
}
export async function loadLessonMotion(entry: Expression, signal?: AbortSignal) {
  if (entry.status !== 'published' || stateErrors(entry).length || !entry.assets.motion) throw new Error('아직 공개되지 않은 레슨입니다.');
  await verifyReviews(entry);
  return parseLessonMotion(entry, await fetchAsset(entry.assets.motion, signal));
}
