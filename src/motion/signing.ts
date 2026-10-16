import { Vector3 } from 'three';
import { q, v } from './math';
import { forwardArm } from './rig';
import { SIDES, type MotionClip, type Pose, type Side } from './types';
import { activeInterval } from '../practice/features';

/**
 * Where the signer's hands are while not signing: arms hanging at the sides, wrists a little in front of the hips
 * (torso-local meters, the avatar's shoulder line is y = 0). Used only when a clip shows no rest of its own.
 */
export const REST_WRIST: Record<Side, [number, number, number]> = { left: [.21, -.5, .12], right: [-.21, -.5, .12] };
/** A wrist counts as raised (signing) at this distance from its rest position, and fully at rest below `NEAR`. */
export const RAISED_METERS = .1;
export const NEAR_REST_METERS = .04;
/** Raised runs shorter than this are tracking blips, not signing. */
const MIN_RUN_MS = 90;
/** Rest baselines: the first / last shown frames of an arm, if they are low enough to be a rest. */
const BASELINE_FRAMES = 3;
const LOW_ENOUGH = -.35;

export type SideActivity = {
  /** Torso-local wrist position per frame, null where the arm is not shown. */
  wrist: (Vector3 | null)[];
  /** Distance from the nearer rest baseline per frame (depth weighted by half), null where the arm is not shown. */
  distance: (number | null)[];
  /** Raised frames after removing blips. */
  raised: boolean[];
  rest: { start: Vector3; end: Vector3; source: { start: 'clip' | 'default'; end: 'clip' | 'default' } };
};
/** Signing interval in seconds: the span between the first and last frame where a hand is raised from rest. */
export type RaisedInterval = { start: number; end: number; method: 'raised-hands' | string; note: string; sides: Record<Side, SideActivity> };

const shown = (pose: Pose, side: Side) => pose.quality.body > 0 && pose.quality[`${side}Arm`] > 0;
/** Wrist position in the torso frame relative to the root (shoulder-line center). */
export function localWrist(pose: Pose, side: Side): Vector3 {
  return forwardArm(pose, side).wrist.sub(v(pose.root)).applyQuaternion(q(pose.rotations.torso).invert());
}
/** Monocular depth is the noisiest axis: a hand resting at the side often drifts several cm in depth alone. */
const DEPTH_WEIGHT = .5;
export const restDistance = (p: Vector3, rest: Vector3) => Math.hypot(p.x - rest.x, p.y - rest.y, (p.z - rest.z) * DEPTH_WEIGHT);
const mean = (points: Vector3[]) => points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length);

/**
 * Per side: how far the wrist is from where that arm rests. The rest baseline is the clip's own first (and last)
 * shown wrist positions when they are low, so a signer who rests the hands in front of the belly is measured from
 * there; otherwise the default rest at the side. Short raised runs (< 90 ms) are ignored.
 */
export function sideActivity(clip: MotionClip, side: Side): SideActivity {
  const frames = clip.frames, wrist = frames.map(f => shown(f.pose, side) ? localWrist(f.pose, side) : null);
  const present = wrist.flatMap((p, i) => p ? [i] : []);
  const fallback = new Vector3(...REST_WRIST[side]);
  const baseline = (indices: number[]) => {
    const points = indices.map(i => wrist[i]!);
    const m = points.length ? mean(points.map(p => p.clone())) : null;
    return m && m.y < LOW_ENOUGH ? { point: m, source: 'clip' as const } : { point: fallback.clone(), source: 'default' as const };
  };
  const start = baseline(present.slice(0, BASELINE_FRAMES)), end = baseline(present.slice(-BASELINE_FRAMES));
  const distance = wrist.map(p => p ? Math.min(restDistance(p, start.point), restDistance(p, end.point)) : null);
  const raised = distance.map(d => d !== null && d > RAISED_METERS);
  for (let i = 0; i < raised.length;) {
    if (!raised[i]) { i++; continue; }
    let j = i;
    while (j + 1 < raised.length && raised[j + 1]) j++;
    if (frames[j].timestamp - frames[i].timestamp < MIN_RUN_MS) for (let k = i; k <= j; k++) raised[k] = false;
    i = j + 1;
  }
  return { wrist, distance, raised, rest: { start: start.point, end: end.point, source: { start: start.source, end: end.source } } };
}

const cache = new WeakMap<MotionClip, RaisedInterval>();
/**
 * The signing interval: from the first to the last frame where either hand is raised from rest. Unlike Practice's
 * motion heuristic (`activeInterval`), small estimation noise while the hands rest does not count as signing, so
 * the rest before and after a sign is outside. Falls back to `activeInterval` when no hand is ever raised.
 */
export function signingInterval(clip: MotionClip): RaisedInterval {
  const cached = cache.get(clip);
  if (cached) return cached;
  const sides = Object.fromEntries(SIDES.map(side => [side, sideActivity(clip, side)])) as Record<Side, SideActivity>;
  const raised = clip.frames.flatMap((_, i) => SIDES.some(side => sides[side].raised[i]) ? [i] : []);
  const fallback = raised.length ? null : activeInterval(clip);
  const interval: RaisedInterval = fallback
    ? { start: fallback.start, end: fallback.end, method: fallback.method, note: fallback.note ?? '', sides }
    : { start: clip.frames[raised[0]].timestamp / 1000, end: clip.frames[raised.at(-1)!].timestamp / 1000, method: 'raised-hands',
      note: 'Hands raised more than 10 cm from their rest position. Rest before and after the sign is excluded.', sides };
  cache.set(clip, interval);
  return interval;
}

/** A side raised in fewer than this fraction of the signing interval's frames does not take part in the sign. */
export const PASSIVE_FRACTION = .15;
export type Participation = Record<Side, { raisedFraction: number; participates: boolean }>;
/**
 * Which hands take part in the sign: a hand raised in at least 15% of the signing interval's frames. When no hand is
 * ever raised (the fallback interval), both count as taking part — nothing is known to be unused.
 */
export function participation(clip: MotionClip): Participation {
  const interval = signingInterval(clip);
  const inside = clip.frames.filter(f => f.timestamp / 1000 >= interval.start - 1e-6 && f.timestamp / 1000 <= interval.end + 1e-6).length;
  return Object.fromEntries(SIDES.map(side => {
    const raisedFraction = inside ? interval.sides[side].raised.filter(Boolean).length / inside : 0;
    return [side, { raisedFraction, participates: interval.method !== 'raised-hands' || raisedFraction >= PASSIVE_FRACTION }];
  })) as Participation;
}
