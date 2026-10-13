import { assetUrl, fetchAsset, loadLessonMotion } from '../content/assets';
import { isPublished, parseCatalog } from '../content/validation';
import type { Catalog, Expression } from '../content/schema';
import { PROGRESS_KEY } from '../lessons/catalog';
import type { MotionClip } from '../motion/types';
import { LEARN_KEY } from './storage';

/**
 * Everything the learning screens read. The published source is the only one in production
 * builds; a development-only demo source can be swapped in without touching the published
 * manifest loader, the motion parser or its synthetic-motion rejection.
 */
export interface ContentSource {
  readonly kind: 'published' | 'demo';
  readonly storage: { progress: string; learn: string };
  /** Always-visible notice for non-published content (the development demo). */
  readonly banner?: string;
  loadCatalog(signal: AbortSignal): Promise<Catalog>;
  loadMotion(entry: Expression, signal?: AbortSignal): Promise<MotionClip>;
  /** Original video for the expression card, or null when none is published. */
  loadVideo(entry: Expression, signal?: AbortSignal): Promise<Blob | null>;
}

export const publishedSource: ContentSource = {
  kind: 'published',
  storage: { progress: PROGRESS_KEY, learn: LEARN_KEY },
  async loadCatalog(signal) {
    const response = await fetch(assetUrl('content/manifest.json'), { signal });
    if (!response.ok) throw new Error('manifest unavailable');
    const catalog = parseCatalog(await response.json());
    // Status is a claim: every entry is re-checked against its evidence before learners see it.
    if (catalog.expressions.some(entry => !isPublished(entry))) throw new Error('unpublished entry in manifest');
    return catalog;
  },
  loadMotion: (entry, signal) => loadLessonMotion(entry, signal),
  async loadVideo(entry, signal) {
    const video = entry.assets.video;
    if (!video) return null;
    return new Blob([new Uint8Array(await fetchAsset(video, signal))], { type: video.mediaType });
  },
};
