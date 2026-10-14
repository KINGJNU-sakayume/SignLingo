import { q } from './math';
import { forwardHand } from './rig';
import { Reconstructor } from './reconstruct';
import { reconstructTemporal } from './temporalReconstruction';
import { sequenceBoundary } from './tracking';
import { SIDES, type MotionClip, type Pose, type Side, type TemporalMotion } from './types';

const degrees = 180 / Math.PI;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const max = (values: number[]) => values.length ? Math.max(...values) : null;
export type MaskMode = 'hand' | 'hand-and-wrist';

/** Drop evidence BEFORE rerunning pass 1. No withheld pose, assignment, or hold
 * enters either reconstruction. This returns a new synthetic trial clip.
 */
export function maskObservations(clip: MotionClip, start: number, count: number, side: Side, mode: MaskMode): MotionClip {
  const solver = new Reconstructor();
  return { ...clip, edits: [], frames: clip.frames.map((source, i) => {
    const hidden = i >= start && i < start + count;
    const index = source.assignment[side];
    const body = source.body.map(p => ({ ...p })), bodyWorld = source.bodyWorld.map(p => ({ ...p }));
    if (hidden && mode === 'hand-and-wrist') for (const points of [body, bodyWorld]) {
      const wrist = points[side === 'left' ? 15 : 16];
      if (wrist) { wrist.visibility = 0; wrist.presence = 0; }
    }
    return solver.reconstruct({ timestamp: source.timestamp, body, bodyWorld,
      hands: hidden ? source.hands.filter((_, j) => j !== index) : source.hands,
      ...(source.discontinuity ? { discontinuity: source.discontinuity } : {}) });
  }) };
}

export function poseError(predicted: Pose, actual: Pose, side: Side) {
  const a = forwardHand(predicted, side), b = forwardHand(actual, side);
  return {
    wristMm: a.wrist.distanceTo(b.wrist) * 1000,
    wristDegrees: q(predicted.rotations[`${side}.wrist`]).angleTo(q(actual.rotations[`${side}.wrist`])) * degrees,
    palmDegrees: a.palm.angleTo(b.palm) * degrees,
    fingerDirectionDegrees: a.segments.reduce((sum, segment, i) => sum + segment.direction.angleTo(b.segments[i].direction) * degrees, 0) / 15,
  };
}

function continuity(poses: Pose[], timestamps: number[], side: Side) {
  const hands = poses.map(p => forwardHand(p, side));
  const velocity = hands.slice(1).map((h, i) => h.wrist.clone().sub(hands[i].wrist).divideScalar((timestamps[i + 1] - timestamps[i]) / 1000));
  const angularVelocity = hands.slice(1).map((h, i) => h.palm.angleTo(hands[i].palm) * degrees / ((timestamps[i + 1] - timestamps[i]) / 1000));
  const acceleration = velocity.slice(1).map((v, i) => v.clone().sub(velocity[i]).divideScalar((timestamps[i + 2] - timestamps[i]) / 2000));
  return {
    maxWristStepMm: max(hands.slice(1).map((h, i) => h.wrist.distanceTo(hands[i].wrist) * 1000)),
    maxPalmStepDegrees: max(hands.slice(1).map((h, i) => h.palm.angleTo(hands[i].palm) * degrees)),
    maxVelocityJumpMps: max(velocity.slice(1).map((v, i) => v.distanceTo(velocity[i]))),
    maxAccelerationJumpMps2: max(acceleration.slice(1).map((a, i) => a.distanceTo(acceleration[i]))),
    maxAngularVelocityJumpDps: max(angularVelocity.slice(1).map((v, i) => Math.abs(v - angularVelocity[i]))),
  };
}

// Bounded local phase-matching proxy against withheld observed poses. Positive
// values mean the prediction resembles an earlier observation (lag). This is
// not an end-to-end camera latency measurement or independent ground truth.
function localLag(predicted: Pose, clip: MotionClip, index: number, side: Side) {
  const candidates = [];
  for (let j = Math.max(0, index - 3); j <= Math.min(clip.frames.length - 1, index + 3); j++) {
    if (clip.frames[j].pose.quality[`${side}State`] !== 'tracked') continue;
    const e = poseError(predicted, clip.frames[j].pose, side);
    candidates.push({ cost: e.palmDegrees + e.fingerDirectionDegrees + e.wristMm / 10, lag: clip.frames[index].timestamp - clip.frames[j].timestamp });
  }
  candidates.sort((a, b) => a.cost - b.cost || Math.abs(a.lag) - Math.abs(b.lag));
  return candidates[0]?.lag ?? 0;
}

export function controlledOcclusion(clip: MotionClip, mode: MaskMode, maxGapMs = 150) {
  return [1, 2, 3, 5].map(gapFrames => {
    let trials = 0, attempted = 0, complete = 0, palmSamples = 0, wristSamples = 0;
    let assigned = 0, identityAgreements = 0;
    const before: ReturnType<typeof poseError>[] = [], after: ReturnType<typeof poseError>[] = [];
    const wristErrors: number[] = [], palmBefore: number[] = [], palmAfter: number[] = [];
    const lagBefore: number[] = [], lagAfter: number[] = [];
    const continuityBefore: ReturnType<typeof continuity>[] = [], continuityAfter: ReturnType<typeof continuity>[] = [];
    const evidence = { observed: 0, interpolated: 0, held: 0, unavailable: 0 };
    for (const side of SIDES) for (let start = 1; start + gapFrames < clip.frames.length; start++) {
      const end = start + gapFrames;
      const window = clip.frames.slice(start - 1, end + 1);
      if (!window.every(f => f.pose.quality[`${side}State`] === 'tracked' && f.pose.quality[side] >= .6 && f.assignment[side] !== undefined)) continue;
      if (window.some((f, i) => i > 0 && sequenceBoundary(window[i - 1], f))) continue;
      trials++; attempted += gapFrames;
      const masked = maskObservations(clip, start, gapFrames, side, mode);
      const enhanced = reconstructTemporal(masked, { maxGapMs });
      let wholeGap = true;
      for (let i = start; i < end; i++) {
        const pose = enhanced.frames[i].pose, e = pose.evidence![side]; evidence[e.state]++;
        const error = poseError(pose, clip.frames[i].pose, side), baseline = poseError(masked.frames[i].pose, clip.frames[i].pose, side);
        if (e.position === 'observed' || e.position === 'interpolated') { wristSamples++; wristErrors.push(error.wristMm); }
        if (e.orientation === 'interpolated') { palmSamples++; palmAfter.push(error.palmDegrees); if (masked.frames[i].pose.quality[`${side}State`] !== 'missing') palmBefore.push(baseline.palmDegrees); }
        if (e.fingers === 'interpolated' && e.orientation === 'interpolated') {
          complete++; after.push(error); lagAfter.push(localLag(pose, clip, i, side));
          if (masked.frames[i].pose.quality[`${side}State`] !== 'missing') { before.push(baseline); lagBefore.push(localLag(masked.frames[i].pose, clip, i, side)); }
        } else wholeGap = false;
      }
      // Report continuity only for completely reconstructed windows. Missing
      // neutral placeholders must not be counted as accurate predictions.
      if (wholeGap) {
        // Include observed steps OUTSIDE both joins, so a constant-speed bridge
        // cannot hide its acceleration discontinuity at entry and exit.
        const lo = Math.max(0, start - 3), hi = Math.min(clip.frames.length, end + 3);
        const context = enhanced.frames.slice(lo, hi), times = context.map(f => f.timestamp);
        const continuous = clip.frames.slice(lo, hi).every((f, i) => i === 0 || !sequenceBoundary(clip.frames[lo + i - 1], f));
        if (continuous && context.every(f => ['observed', 'interpolated'].includes(f.pose.evidence![side].fingers))) {
          continuityAfter.push(continuity(context.map(f => f.pose), times, side));
          if (masked.frames.slice(lo, hi).every(f => f.pose.quality[`${side}State`] !== 'missing')) continuityBefore.push(continuity(masked.frames.slice(lo, hi).map(f => f.pose), times, side));
        }
      }
      // Remaining measured hands: compare identities to the supplied baseline
      // after mapping detection indices through removal, never to array order.
      for (let i = start - 1; i <= end; i++) for (const observedSide of SIDES) {
        const original = clip.frames[i], index = original.assignment[observedSide];
        if (index === undefined || original.pose.quality[observedSide] < .6) continue;
        const expected = masked.frames[i].hands.indexOf(original.hands[index]);
        if (expected < 0) continue;
        const actual = enhanced.frames[i].assignment[observedSide];
        if (actual !== undefined) { assigned++; if (actual === expected) identityAgreements++; }
      }
    }
    const aggregate = <T extends Record<string, number | null>>(items: T[]) => items.length ? Object.fromEntries(Object.keys(items[0]).map(key => [key, mean(items.flatMap(item => item[key] === null ? [] : [item[key] as number]))])) : null;
    return { gapFrames, trials, attempted, complete, palmSamples, wristSamples, evidence,
      beforeSamples: before.length, afterSamples: after.length, before: aggregate(before), after: aggregate(after),
      wristMeanMm: mean(wristErrors), palmBeforeMeanDegrees: mean(palmBefore), palmAfterMeanDegrees: mean(palmAfter),
      identity: { assigned, agreementsWithBaseline: identityAgreements, disagreement: assigned - identityAgreements },
      lagBeforeMs: mean(lagBefore), lagAfterMs: mean(lagAfter),
      continuityBeforeWindows: continuityBefore.length, continuityAfterWindows: continuityAfter.length,
      continuityBefore: aggregate(continuityBefore), continuityAfter: aggregate(continuityAfter) };
  });
}

export function temporalSummary(clip: MotionClip, enhanced: TemporalMotion) {
  return Object.fromEntries(SIDES.map(side => {
    const count = (predicate: (i: number) => boolean) => clip.frames.filter((_, i) => predicate(i)).length;
    return [side, {
      baseline: Object.fromEntries(['tracked', 'held', 'missing'].map(state => [state, count(i => clip.frames[i].pose.quality[`${side}State`] === state)])),
      enhanced: Object.fromEntries(['observed', 'interpolated', 'held', 'unavailable'].map(state => [state, count(i => enhanced.frames[i].pose.evidence![side].state === state)])),
      completeInterpolations: count(i => enhanced.frames[i].pose.evidence![side].orientation === 'interpolated' && enhanced.frames[i].pose.evidence![side].fingers === 'interpolated'),
      partialInterpolations: count(i => enhanced.frames[i].pose.evidence![side].state === 'interpolated' && enhanced.frames[i].pose.evidence![side].fingers === 'unavailable'),
      identityDisagreements: count(i => enhanced.frames[i].assignment[side] !== undefined && clip.frames[i].assignment[side] !== undefined && enhanced.frames[i].assignment[side] !== clip.frames[i].assignment[side]),
      ambiguous: count(i => enhanced.frames[i].pose.evidence![side].identity === 'ambiguous'),
      recovered: enhanced.frames.flatMap((f, i) => f.pose.evidence![side].state === 'interpolated' ? [{ index: i, timestamp: f.timestamp, ...f.pose.evidence![side] }] : []),
    }];
  }));
}
