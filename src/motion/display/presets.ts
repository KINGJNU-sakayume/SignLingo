import type { MotionClip } from '../types';
import { fillHands } from './fillHands';
import { runDisplayPipeline } from './pipeline';
import { stabilizeTorso } from './stabilizeTorso';
import type { DisplayClip, DisplayStage } from './types';

/**
 * learner: lesson, expression card and the Practice reference (still torso, filled hands).
 * attempt: the learner's own Practice recording keeps its tracking gaps visible.
 * lab-*: Motion Lab shows stored poses unless its "몸통 고정" toggle is on.
 */
export type DisplayPreset = 'learner' | 'attempt' | 'lab-original' | 'lab-stabilized';
export const PRESETS: Record<DisplayPreset, () => DisplayStage[]> = {
  learner: () => [stabilizeTorso(), fillHands()],
  attempt: () => [stabilizeTorso()],
  'lab-original': () => [],
  'lab-stabilized': () => [stabilizeTorso()],
};
const cache = new WeakMap<MotionClip, Map<DisplayPreset, DisplayClip>>();
/** Cached per clip object: clips are immutable once loaded, so a preset is computed once. */
export function displayFor(clip: MotionClip, preset: DisplayPreset): DisplayClip {
  let byPreset = cache.get(clip);
  if (!byPreset) cache.set(clip, byPreset = new Map());
  let display = byPreset.get(preset);
  if (!display) byPreset.set(preset, display = runDisplayPipeline({ clip }, PRESETS[preset]()));
  return display;
}
