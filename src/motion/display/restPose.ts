import { Matrix4, Quaternion, Vector3 } from 'three';
import { boneQuaternion, eulerQuat, q, qa, rad, solveArm, v } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { localWrist, NEAR_REST_METERS, RAISED_METERS, restDistance, signingInterval } from '../signing';
import { FINGERS, SIDES, type DisplayPose, type Side } from '../types';
import { armVisible, withPose } from './pipeline';
import type { DisplayClip, DisplayFrame, DisplayStage, HandAnnotation } from './types';

export const REST_STAGE = 'rest-pose';
/** Arms shown at rest: frames before an arm's first and after its last sustained tracking, blending into it. */
export const REST_BLEND_MS = 300;
/** Shorter tracked runs of an arm (tracking blips while it rests) do not anchor anything. */
const SUSTAINED_MS = 150;
const BLIP_MS = 100;
export type RestReport = Record<Side, { restArms: number; restHands: number; blended: number; passive: boolean }>;
/** A side raised in fewer than this fraction of the signing interval's frames does not take part in the sign. */
export const PASSIVE_FRACTION = .15;

// A relaxed hand: fingers slightly curled, thumb resting alongside. Left hand, [flexion, spread] degrees per joint
// (the constraint presets' parameterization); the right hand mirrors the spread.
const RELAXED: Record<typeof FINGERS[number], [number, number][]> = {
  thumb: [[8, 14], [12, 0], [8, 0]], index: [[12, 2], [18, 0], [10, 0]], middle: [[16, 0], [22, 0], [12, 0]],
  ring: [[20, -2], [24, 0], [12, 0]], pinky: [[24, -5], [26, 0], [12, 0]],
};
export function relaxedFingers(side: Side): Record<string, Quaternion> {
  const out: Record<string, Quaternion> = {}, mirror = side === 'right' ? -1 : 1;
  for (const finger of FINGERS) RELAXED[finger].forEach(([flex, spread], j) => { out[`${side}.${finger}.${j}`] = eulerQuat(rad(flex), 0, rad(spread * mirror)); });
  return out;
}
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const inward = (side: Side, torso: Quaternion) => new Vector3(side === 'left' ? -1 : 1, 0, 0).applyQuaternion(torso);

/** A hanging hand: fingers continue the forearm, palm toward the thigh (the body midline). */
function restPalm(elbow: Vector3, wrist: Vector3, side: Side, torso: Quaternion) {
  const y = wrist.clone().sub(elbow).normalize(), z = inward(side, torso);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = y.clone().cross(z).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize();
}
/** The forearm frame without its allocated roll, as solveArm() builds it (see fillHands). */
function bareForearm(pose: DisplayPose, side: Side) {
  const arm = forwardArm(pose, side);
  const upper = arm.elbow.clone().sub(arm.shoulder), lower = arm.wrist.clone().sub(arm.elbow);
  return { arm, frame: boneQuaternion(lower, upper.clone().cross(lower).normalize()) };
}
/** Re-attach a world palm orientation to the current arm (roll split as in the reconstruction). */
function setPalm(pose: DisplayPose, side: Side, palm: Quaternion) {
  const { arm, frame } = bareForearm(pose, side);
  const { forearm, wrist } = distributeForearmRoll(frame, palm);
  pose.rotations[`${side}.lower`] = qa(arm.upper.clone().invert().multiply(forearm));
  pose.rotations[`${side}.wrist`] = qa(wrist);
}
const fingerKeys = (side: Side) => FINGERS.flatMap(f => [0, 1, 2].map(j => `${side}.${f}.${j}`));
const clonePose = (pose: DisplayPose): DisplayPose => ({ ...pose, rotations: { ...pose.rotations } });
/** Hands with no observation behind them: what a rest hand may replace. */
function unobserved(hand: HandAnnotation) {
  return hand.state === 'missing' || hand.state === 'held' || hand.state === 'filled' || (hand.state === 'constrained' && hand.evidence !== 'observed');
}
/** 1 at the rest position, 0 once the wrist is raised (signing), smooth in between. */
const restness = (distance: number) => 1 - smooth((distance - NEAR_REST_METERS) / (RAISED_METERS - NEAR_REST_METERS));

/**
 * The signer's rest before and after a sign, for learner screens. Display-only, like hand filling:
 * - A hand with no observation (missing, held, filled, or produced by a constraint) whose wrist is near its rest
 *   position takes a relaxed handshape hanging along the forearm, blended by how close the wrist is to rest. Before
 *   the hand's first raised frame and after its last one, observed hands rest too (a pre-shaped hand would give the
 *   sign away), as does a hand that takes no part in the sign. A sign's handshape therefore never shows on resting
 *   hands, and appears while the hand rises.
 * - An arm that is not tracked before its first (after its last) sustained tracking hangs at the rest position
 *   measured for the clip (`signingInterval`), and moves into (out of) the first (last) tracked pose over
 *   `REST_BLEND_MS`. A gap between two tracked runs is filled only when both ends are at rest; an arm lost while
 *   raised stays hidden.
 * Rest hands and arms are annotated (`rest`) and drawn gray. Observed hands inside the sign are never changed, except
 * sub-100 ms detection blips while the hand rests.
 */
export function restPose(): DisplayStage {
  return { id: REST_STAGE, run(display: DisplayClip, input): DisplayClip {
    const interval = signingInterval(input.clip), activity = interval.sides;
    const inside = input.clip.frames.filter(f => f.timestamp / 1000 >= interval.start - 1e-6 && f.timestamp / 1000 <= interval.end + 1e-6).length;
    const frames = display.frames.slice();
    const report: RestReport = { left: { restArms: 0, restHands: 0, blended: 0, passive: false }, right: { restArms: 0, restHands: 0, blended: 0, passive: false } };
    for (const side of SIDES) {
      const rest = activity[side].rest;
      // A hand that stays down through the sign (e.g. the non-dominant hand of a one-handed sign) takes no part in
      // it: all its frames show the rest hand, observed or not, so it does not flicker between estimates.
      const passive = interval.method === 'raised-hands' && activity[side].raised.filter(Boolean).length < PASSIVE_FRACTION * inside;
      report[side].passive = passive;
      const distance = (pose: DisplayPose) => { const p = localWrist(pose, side); return Math.min(restDistance(p, rest.start), restDistance(p, rest.end)); };
      // Shown arms: relax unobserved hands near rest. Rest weights are averaged over ±2 frames, and the drawn state
      // switches with hysteresis, so a hand hovering near the threshold does not flicker between gray and color.
      const raw = frames.map(f => armVisible(f.pose, side) ? restness(distance(f.pose)) : null);
      const weight = raw.map((r, i) => {
        if (r === null) return 0;
        const near = raw.slice(Math.max(0, i - 2), i + 3).filter((x): x is number => x !== null);
        return near.reduce((a, b) => a + b, 0) / near.length;
      });
      // An observation lasting under 100 ms while the hand rests is a detection blip, not a handshape to show.
      const seen = frames.map(f => !passive && !unobserved(f.annotation.hands[side])), times = frames.map(f => f.timestamp);
      const observedRun = runLengths(seen, times), unseenRun = runLengths(seen.map(x => !x), times);
      // Likewise a brief gap between observations keeps its filled bridge rather than flashing a rest hand.
      const bridged = (i: number) => unseenRun[i] !== null && unseenRun[i]! < BLIP_MS && seen.slice(0, i).includes(true) && seen.slice(i + 1).includes(true);
      // Before the side's first raised frame and after its last one the hand rests even where it was observed: a
      // signer often shapes the hand before raising it, and that shape would give the sign away.
      const raisedAt = activity[side].raised.flatMap((x, i) => x ? [i] : []);
      const outside = (i: number) => !raisedAt.length || i < raisedAt[0] || i > raisedAt.at(-1)!;
      let resting = true;
      frames.forEach((frame, i) => {
        const hand = frame.annotation.hands[side], r = weight[i];
        resting = passive || (resting ? r > .4 : r >= .6);
        const forced = passive || (outside(i) && resting);
        const blip = !forced && observedRun[i] !== null && observedRun[i]! < BLIP_MS && resting;
        if (!armVisible(frame.pose, side) || (!unobserved(hand) && !blip && !forced) || (r <= 0 && !passive) || (hand.state !== 'missing' && !forced && bridged(i))) return;
        const pose = clonePose(frame.pose), torso = q(pose.rotations.torso), arm = forwardArm(pose, side);
        const target = restPalm(arm.elbow, arm.wrist, side, torso), relaxed = relaxedFingers(side);
        const fresh = hand.state === 'missing' || blip;
        const amount = passive ? Math.max(r, .5) : r;
        setPalm(pose, side, hand.state === 'missing' ? target : arm.palm.clone().slerp(target, amount));
        for (const key of fingerKeys(side)) pose.rotations[key] = qa(fresh ? relaxed[key] : q(pose.rotations[key]).slerp(relaxed[key], amount));
        const state = fresh || resting || forced ? 'rest' : hand.state;
        frames[i] = withPose(frame, pose, REST_STAGE, { hands: { ...frame.annotation.hands, [side]: state === 'rest' ? { state } : hand } });
        if (state === 'rest') report[side].restHands++;
      });
      // Untracked arms: rest pose before the first / after the last sustained run, blended into it.
      const segments = new Map<number, number[]>();
      frames.forEach((f, i) => { if (f.pose.quality.body > 0) segments.set(f.segment, [...segments.get(f.segment) ?? [], i]); });
      for (const indices of segments.values()) {
        const shownRun = sustained(indices, i => armVisible(frames[i].pose, side), i => frames[i].timestamp);
        for (const i of indices) {
          if (shownRun.has(i)) continue;
          const before = [...shownRun].filter(k => k < i).at(-1), after = [...shownRun].find(k => k > i);
          // A gap inside the sign stays hidden unless both ends rest.
          if (before !== undefined && after !== undefined && (distance(frames[before].pose) > RAISED_METERS || distance(frames[after].pose) > RAISED_METERS)) continue;
          const anchor = after === undefined ? before : before === undefined ? after
            : frames[i].timestamp - frames[before].timestamp <= frames[after].timestamp - frames[i].timestamp ? before : after;
          const baseline = before === undefined ? rest.start : after === undefined ? rest.end : rest.start.clone().lerp(rest.end, .5);
          const w = anchor === undefined ? 0 : smooth(1 - Math.abs(frames[i].timestamp - frames[anchor].timestamp) / REST_BLEND_MS);
          frames[i] = restArm(frames[i], side, baseline, w > 0 ? frames[anchor!] : undefined, w);
          report[side].restArms++;
          if (w > 0) report[side].blended++;
        }
      }
    }
    return { ...display, frames, reports: { ...display.reports, [REST_STAGE]: report } };
  } };
}

/** Per index: the duration of the run of `flags` containing it, or null where the flag is false. */
function runLengths(flags: boolean[], times: number[]) {
  const out: (number | null)[] = flags.map(() => null);
  for (let a = 0; a < flags.length;) {
    if (!flags[a]) { a++; continue; }
    let b = a;
    while (b + 1 < flags.length && flags[b + 1]) b++;
    for (let k = a; k <= b; k++) out[k] = times[b] - times[a];
    a = b + 1;
  }
  return out;
}
/** Indices in runs where `shown` holds for at least SUSTAINED_MS (or the whole segment, if it is shorter). */
function sustained(indices: number[], shown: (i: number) => boolean, time: (i: number) => number) {
  const out = new Set<number>();
  for (let a = 0; a < indices.length;) {
    if (!shown(indices[a])) { a++; continue; }
    let b = a;
    while (b + 1 < indices.length && shown(indices[b + 1])) b++;
    if (time(indices[b]) - time(indices[a]) >= SUSTAINED_MS || (a === 0 && b === indices.length - 1)) for (let k = a; k <= b; k++) out.add(indices[k]);
    a = b + 1;
  }
  return out;
}

/** The arm hanging at `baseline` (torso-local wrist), moved toward the anchor frame's arm by weight w. */
function restArm(frame: DisplayFrame, side: Side, baseline: Vector3, anchor: DisplayFrame | undefined, w: number): DisplayFrame {
  const pose = clonePose(frame.pose), torso = q(pose.rotations.torso).normalize(), root = v(pose.root);
  const shoulder = new Vector3(side === 'left' ? .19 : -.19, 0, 0).applyQuaternion(torso).add(root);
  const toWorld = (local: Vector3) => local.clone().applyQuaternion(torso).add(root);
  let target = toWorld(baseline), elbowHint = toWorld(new Vector3(side === 'left' ? .23 : -.23, -.27, -.04));
  const relaxed = relaxedFingers(side);
  let fingers = relaxed, palmBlend: Quaternion | undefined;
  if (anchor && w > 0) {
    const other = forwardArm(anchor.pose, side);
    target = target.lerp(other.wrist, w); elbowHint = elbowHint.lerp(other.elbow, w);
    // A hidden anchor hand has no orientation or fingers to move toward.
    if (anchor.annotation.hands[side].state !== 'missing') {
      palmBlend = other.palm;
      fingers = Object.fromEntries(fingerKeys(side).map(key => [key, relaxed[key].clone().slerp(q(anchor.pose.rotations[key]), w)]));
    }
  }
  const arm = solveArm(shoulder, target, elbowHint);
  pose.rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(arm.upperQ));
  pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(arm.lowerQ));
  const palm = restPalm(arm.elbow, arm.wrist, side, torso);
  setPalm(pose, side, palmBlend ? palm.slerp(palmBlend, w) : palm);
  for (const key of fingerKeys(side)) pose.rotations[key] = qa(fingers[key]);
  return withPose(frame, pose, REST_STAGE, { hands: { ...frame.annotation.hands, [side]: { state: 'rest' } }, arms: { ...frame.annotation.arms, [side]: 'rest' } });
}
