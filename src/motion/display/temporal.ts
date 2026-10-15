import { reconstructTemporal } from '../temporalReconstruction';
import { SIDES, type MotionClip, type Side } from '../types';
import { baseFrames } from './pipeline';
import type { DisplayClip, DisplayHandState, DisplayStage } from './types';

export const TEMPORAL_STAGE = 'temporal-reconstruct';
/** Learner screens compute this synchronously once per clip; longer clips keep the stored hands. */
export const TEMPORAL_MAX_FRAMES = 1800;
export type TemporalReport = {
  applied: boolean;
  /** Why the stored hands were kept: the clip records no temporal policy, too low a rate, or too few/many frames. */
  reason?: 'not-recorded' | 'sample-rate' | 'frame-count' | 'supplied';
  maxGapMs?: number;
  hands: Record<Side, Record<DisplayHandState, number>>;
};

/** Why the learner temporal stage does not apply to this clip, or undefined when it does. */
export function temporalSkipReason(clip: MotionClip): TemporalReport['reason'] {
  if (!clip.pipeline.temporal) return 'not-recorded';
  if (clip.source.sampleHz < 15) return 'sample-rate';
  if (clip.frames.length < 3 || clip.frames.length > TEMPORAL_MAX_FRAMES) return 'frame-count';
}
const count = (display: DisplayClip, side: Side) => {
  const states: Record<DisplayHandState, number> = { observed: 0, interpolated: 0, held: 0, filled: 0, constrained: 0, rest: 0, missing: 0 };
  for (const frame of display.frames) states[frame.annotation.hands[side].state]++;
  return states;
};

/**
 * Display-only temporal reconstruction (`conservative-bidirectional-v1`) as the first learner stage. Clips record
 * the policy from pipeline 0.3.x on, so published 0.2.0 clips keep exactly the hands they were reviewed with.
 * Short gaps between reliable observations become `interpolated` hands; what remains is left to later stages.
 * The stored clip, its evidence and Practice comparisons never see this result.
 */
export function temporalReconstruct(): DisplayStage {
  return { id: TEMPORAL_STAGE, run(display: DisplayClip, input): DisplayClip {
    if (display.stages.length) throw new Error(`${TEMPORAL_STAGE} must be the first display stage.`);
    const { clip } = input, reason = input.temporal ? 'supplied' : temporalSkipReason(clip);
    if (reason) {
      const report: TemporalReport = { applied: false, reason, hands: { left: count(display, 'left'), right: count(display, 'right') } };
      return { ...display, reports: { ...display.reports, [TEMPORAL_STAGE]: report } };
    }
    const maxGapMs = clip.pipeline.temporal!.maxGapMs;
    const frames = baseFrames({ clip, temporal: reconstructTemporal(clip, { maxGapMs }) }).map((frame, i) =>
      SIDES.some(side => frame.annotation.hands[side].state !== display.frames[i].annotation.hands[side].state)
        ? { ...frame, annotation: { ...frame.annotation, stages: [TEMPORAL_STAGE] } } : frame);
    const next = { ...display, frames };
    const report: TemporalReport = { applied: true, maxGapMs, hands: { left: count(next, 'left'), right: count(next, 'right') } };
    return { ...next, reports: { ...display.reports, [TEMPORAL_STAGE]: report } };
  } };
}
