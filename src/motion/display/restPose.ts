import { Matrix4, Quaternion, Vector3 } from 'three';
import { boneQuaternion, eulerQuat, q, qa, rad, solveArm, v } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { localWrist, NEAR_REST_METERS, participation, RAISED_METERS, restDistance, signingInterval } from '../signing';
import { FINGERS, SIDES, type DisplayPose, type Side } from '../types';
import { armVisible, withPose } from './pipeline';
import type { DisplayClip, DisplayFrame, DisplayStage, HandAnnotation } from './types';

export const REST_STAGE = 'rest-pose';
/** Arms shown at rest: frames before an arm's first and after its last sustained tracking, blending into it. */
export const REST_BLEND_MS = 300;
/** Shorter tracked runs of an arm (tracking blips while it rests) do not anchor anything. */
const SUSTAINED_MS = 150;
export type RestReport = Record<Side, { restArms: number; restHands: number; blended: number; passive: boolean }>;

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
    const taking = participation(input.clip);
    const frames = display.frames.slice();
    const report: RestReport = { left: { restArms: 0, restHands: 0, blended: 0, passive: false }, right: { restArms: 0, restHands: 0, blended: 0, passive: false } };
    for (const side of SIDES) {
      const rest = activity[side].rest;
      // A hand that stays down through the sign (e.g. the non-dominant hand of a one-handed sign) takes no part in
      // it: all its frames show the rest hand, observed or not, so it does not flicker between estimates.
      const passive = !taking[side].participates;
      report[side].passive = passive;
      const distance = (pose: DisplayPose) => { const p = localWrist(pose, side); return Math.min(restDistance(p, rest.start), restDistance(p, rest.end)); };
      // Shown arms. The sign's handshape forms while the hand travels from rest to where the sign starts, and
      // dissolves on the way back: a time-based ramp from the moment the wrist leaves its rest (within 4 cm) until
      // it arrives (85% of its first reach), morphing the relaxed hand into the handshape it has on arrival (and
      // back from the one it has when it starts down). Before and after, every hand rests: a signer often shapes the
      // hand before raising it, and that shape would give the sign away. A hand that takes no part in the sign rests
      // throughout. Inside the sign only unobserved hands that come back near rest relax, by distance.
      const shown = frames.map(f => armVisible(f.pose, side));
      const near = frames.map((f, i) => shown[i] ? distance(f.pose) : null);
      const raw = near.map(d => d === null ? null : restness(d));
      const weight = raw.map((r, i) => {
        if (r === null) return 0;
        const around = raw.slice(Math.max(0, i - 2), i + 3).filter((x): x is number => x !== null);
        return around.reduce((a, b) => a + b, 0) / around.length;
      });
      const raisedAt = activity[side].raised.flatMap((x, i) => x ? [i] : []);
      const ramps = passive || !raisedAt.length ? null : transitions(frames, near, raisedAt[0], raisedAt.at(-1)!, side);
      const relaxed = relaxedFingers(side);
      let resting = false, lastOut = ramps?.out.shape, outStarted = false;
      frames.forEach((frame, i) => {
        if (!shown[i]) return;
        const hand = frame.annotation.hands[side], t = frame.timestamp;
        const ramp = ramps && (t < ramps.in.arrive || t > ramps.out.depart);
        let w: number, anchor: Anchor | undefined;
        if (passive || !ramps) w = passive ? Math.max(weight[i], .5) : (unobserved(hand) ? weight[i] : 0);
        else if (ramp) {
          const into = t < ramps.in.arrive, edge = into ? ramps.in : ramps.out;
          w = into ? 1 - smooth((t - edge.leave) / (edge.arrive - edge.leave)) : smooth((t - edge.depart) / (edge.back - edge.depart));
          // In: from the shape on arrival (frames before it are often unobserved or pre-shaped). Out: from this
          // frame's own hand while there is one, else the last one drawn.
          if (into) anchor = edge.shape;
          else {
            // Starts from the hand drawn just before the morph, so its first frame continues it.
            if (!outStarted) { outStarted = true; lastOut = (i > 0 && shown[i - 1] ? anchorAt(frames, i - 1, side) : undefined) ?? lastOut; }
            const own = anchorAt(frames, i, side), dt = i > 0 ? frame.timestamp - frames[i - 1].timestamp : 0;
            lastOut = own && lastOut ? follow(lastOut, own, MAX_TURN_DEG_PER_S * dt / 1000) : own ?? lastOut;
            anchor = lastOut;
          }
        } else {
          resting = resting ? weight[i] > .4 : weight[i] >= .6;
          w = unobserved(hand) ? weight[i] : 0;
        }
        if (w <= 0 && hand.state !== 'missing') return;
        if (w <= 0 && !anchor) return;
        const pose = clonePose(frame.pose), torso = q(pose.rotations.torso);
        const { arm, frame: bare } = bareForearm(pose, side);
        const relaxedRelative = bare.clone().invert().multiply(restPalm(arm.elbow, arm.wrist, side, torso));
        // From: the anchor shape on a ramp, else this frame's own hand (a hidden hand has none: the relaxed one).
        const fromRelative = anchor ? anchor.relative : hand.state === 'missing' ? relaxedRelative : bare.clone().invert().multiply(arm.palm);
        const fromFingers = (key: string, n: number) => anchor ? anchor.fingers[n] : hand.state === 'missing' ? relaxed[key] : q(pose.rotations[key]);
        setPalm(pose, side, bare.clone().multiply(fromRelative.clone().slerp(relaxedRelative, w)));
        fingerKeys(side).forEach((key, n) => { pose.rotations[key] = qa(fromFingers(key, n).clone().slerp(relaxed[key], w).normalize()); });
        const rest = w >= .5 || passive || (!ramp && resting && unobserved(hand));
        const state: HandAnnotation = rest ? { state: 'rest', restWeight: passive ? 1 : w, ...(anchor && w < 1 ? { under: anchor.state } : {}) } : anchor ? { state: anchor.state, restWeight: w, ...(anchor.evidence ? { evidence: anchor.evidence } : {}) } : { ...hand, restWeight: w };
        frames[i] = withPose(frame, pose, REST_STAGE, { hands: { ...frame.annotation.hands, [side]: state } });
        if (rest) report[side].restHands++;
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

/** A handshape relative to the roll-free forearm, as hand filling copies it, plus how it is drawn. */
type Anchor = { relative: Quaternion; fingers: Quaternion[]; state: HandAnnotation['state']; evidence?: HandAnnotation['evidence'] };
type Edge = { leave: number; arrive: number; depart: number; back: number; shape?: Anchor };
/** Reach counted as arrival: the wrist has covered this fraction of its first (last) excursion from rest. */
const ARRIVE = .85;
/** How far ahead (behind) of the first (last) raised frame that excursion is measured. */
const REACH_WINDOW_MS = 700;
/** Shortest handshape morph; a faster rise starts the morph earlier, while the hand is still at rest. */
const MIN_RAMP_MS = 250;
/**
 * On the way down the drawn handshape follows the frame's own one at most this fast: the end of a constraint span or a
 * noisy estimate can otherwise flip a palm or finger by 50° in one frame just before the hand rests.
 */
const MAX_TURN_DEG_PER_S = 400;
/**
 * Moves each rotation of `from` toward `to` by at most `limit` degrees. The drawn state stays `from`'s, so a single
 * differently tracked frame on the way down does not flash another color.
 */
function follow(from: Anchor, to: Anchor, limit: number): Anchor {
  const step = (a: Quaternion, b: Quaternion) => { const angle = a.angleTo(b) * 180 / Math.PI; return a.clone().slerp(b, angle <= limit ? 1 : limit / angle); };
  return { ...from, relative: step(from.relative, to.relative), fingers: from.fingers.map((f, n) => step(f, to.fingers[n])) };
}
/** The handshape relaxes over this last stretch of the way back to rest. */
const RELAX_MS = 350;

function anchorAt(frames: DisplayFrame[], i: number, side: Side): Anchor | undefined {
  const frame = frames[i], hand = frame?.annotation.hands[side];
  if (!frame || !hand || hand.state === 'missing') return undefined;
  const { arm, frame: bare } = bareForearm(frame.pose, side);
  return { relative: bare.clone().invert().multiply(arm.palm).normalize(), fingers: fingerKeys(side).map(key => q(frame.pose.rotations[key])),
    state: hand.state, ...(hand.evidence ? { evidence: hand.evidence } : {}) };
}
/** Where the hand leaves rest and arrives at the sign, and where it starts back and is at rest again (ms). */
function transitions(frames: DisplayFrame[], near: (number | null)[], first: number, last: number, side: Side) {
  const time = (i: number) => frames[i].timestamp;
  const reach = (from: number, to: number) => Math.max(0, ...near.slice(Math.max(0, from), to + 1).map(d => d ?? 0));
  // Arrival: the first frame from the onset with ARRIVE of the reach ahead; departure, mirrored.
  const ahead = frames.findIndex(f => f.timestamp > time(first) + REACH_WINDOW_MS), aheadEnd = ahead < 0 ? frames.length - 1 : ahead;
  const peakIn = reach(first, aheadEnd);
  let arrive = first; while (arrive < aheadEnd && (near[arrive] ?? 0) < ARRIVE * peakIn) arrive++;
  let behind = frames.length - 1; while (behind > 0 && frames[behind].timestamp >= time(last) - REACH_WINDOW_MS) behind--;
  const behindStart = Math.max(0, behind);
  const peakOut = reach(behindStart, last);
  let depart = last; while (depart > behindStart && (near[depart] ?? 0) < ARRIVE * peakOut) depart--;
  if (depart < arrive) depart = arrive;
  // Leaving: the last frame before the onset still within 4 cm of rest; back: the first after the end.
  let leave = first; while (leave > 0 && near[leave - 1] !== null && near[leave - 1]! > NEAR_REST_METERS) leave--;
  if (leave > 0) leave--;
  let back = last; while (back < frames.length - 1 && near[back + 1] !== null && near[back + 1]! > NEAR_REST_METERS) back++;
  if (back < frames.length - 1) back++;
  // The morph in runs while the hand rises (at least MIN_RAMP_MS: it starts earlier, the hand still resting). The
  // handshape is kept on the way down — lowering can be part of the sign — and relaxes over the last RELAX_MS
  // before the hand is back at rest.
  const tl = Math.min(time(leave), time(arrive) - MIN_RAMP_MS), ta = time(arrive);
  const tb = time(back), td = Math.max(time(depart), tb - RELAX_MS);
  // The shapes the morph runs to and from: the first (last) drawn hand at or after arrival (before departure).
  let a = arrive; while (a < depart && !anchorAt(frames, a, side)) a++;
  let d = depart; while (d > arrive && !anchorAt(frames, d, side)) d--;
  return { in: { leave: tl, arrive: ta, depart: td, back: tb, shape: anchorAt(frames, a, side) } as Edge,
    out: { leave: tl, arrive: ta, depart: td, back: tb, shape: anchorAt(frames, d, side) } as Edge };
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
