import type { ConstraintSet } from '../constraints/schema';
import type { MotionClip } from '../types';
import { constrain } from './constraints';
import { fillHands } from './fillHands';
import { runDisplayPipeline } from './pipeline';
import { stabilizeTorso } from './stabilizeTorso';
import { restPose } from './restPose';
import { separate } from './separateHands';
import { smoothMotion } from './smoothMotion';
import { temporalReconstruct } from './temporal';
import type { DisplayClip, DisplayStage } from './types';

/**
 * learner: lesson, expression card and the Practice reference (temporal bridges where the clip records the
 *   0.3.x policy, then still torso, filled hands and the rest before and after the sign).
 * attempt: the learner's own Practice recording keeps its tracking gaps visible.
 * lab-*: Motion Lab shows stored poses unless its "몸통 고정" toggle is on.
 */
export type DisplayPreset = 'learner' | 'attempt' | 'lab-original' | 'lab-stabilized';
/**
 * Learner stages: temporal reconstruction → torso held still → [constraint preview] → jitter smoothing → hand filling →
 * rest pose → hand contact. The torso never follows a bow or lean on learner screens (the head keeps its own rotation,
 * the hands their positions). Smoothing, rest pose and hand contact only present the motion; tracking reports leave
 * them out with `presentation: false`. A corrected (version-2) clip already stores its constraints, so the learner
 * preset itself has no constraint stage.
 */
export const learnerStages = (constraints?: ConstraintSet, { presentation = true }: { presentation?: boolean } = {}): DisplayStage[] =>
  [temporalReconstruct(), stabilizeTorso({ fixedMaxDegrees: LEARNER_TORSO_FIXED }), ...(constraints ? [constrain(constraints)] : []), ...(presentation ? [smoothMotion()] : []), fillHands(), ...(presentation ? [restPose(), separate()] : [])];
/** Learner screens hold the torso at its median orientation whatever its variation (a bow in the recording included). */
export const LEARNER_TORSO_FIXED = 180;
export const PRESETS: Record<DisplayPreset, () => DisplayStage[]> = {
  learner: () => learnerStages(),
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
