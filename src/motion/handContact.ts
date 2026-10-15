import { Vector3 } from 'three';
import { q, qa, solveArm } from './math';
import { distributeForearmRoll } from './hand';
import { fingerLengths, forwardArm } from './rig';
import { fingerChain, handState, type HandState } from './constraints/points';
import { FINGERS, SIDES, type DisplayPose, type Side } from './types';

/**
 * Collision volumes of the avatar hand, matching the meshes in Avatar.tsx: finger capsules (radius 10 mm thumb base,
 * 8 / 7 / 6 mm from base to tip), the palm ellipsoid (37 × 47 × 14 mm half axes around palm-local y = 42 mm) as
 * three 13 mm capsules along its length, and the 22 mm wrist sphere. Forearms are not included.
 */
export type Capsule = { a: Vector3; b: Vector3; r: number; part: string };
const PALM_LINES: [number, number, number][] = [[-.024, .014, .07], [0, .008, .078], [.024, .014, .07]];
const FINGER_RADII = (finger: string) => finger === 'thumb' ? [.01, .008, .007] : [.008, .007, .006];

export function handCapsules(hand: HandState, side: Side): Capsule[] {
  const out: Capsule[] = [{ a: hand.wrist.clone(), b: hand.wrist.clone(), r: .022, part: 'wrist' }];
  for (const [x, y0, y1] of PALM_LINES) {
    const sx = side === 'right' ? -x : x;
    out.push({ a: new Vector3(sx, y0, 0).applyQuaternion(hand.palm).add(hand.wrist), b: new Vector3(sx, y1, 0).applyQuaternion(hand.palm).add(hand.wrist), r: .013, part: 'palm' });
  }
  for (const finger of FINGERS) {
    const chain = fingerChain(hand, side, finger), radii = FINGER_RADII(finger);
    for (let j = 0; j < 3; j++) if (fingerLengths[finger][j] > 0) out.push({ a: chain[j], b: chain[j + 1], r: radii[j], part: `${finger}.${j}` });
  }
  return out;
}

/** Closest points between segments p1–q1 and p2–q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function closestPoints(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): [Vector3, Vector3] {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return [p1.clone(), p2.clone()];
  if (a <= 1e-12) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
}

export type Penetration = { depth: number; normal: Vector3; left: string; right: string };
/** Every overlapping pair of volumes, `normal` pointing from the right hand toward the left hand. */
function overlaps(left: HandState, right: HandState, fallback: Vector3): Penetration[] {
  const cl = handCapsules(left, 'left'), cr = handCapsules(right, 'right'), out: Penetration[] = [];
  for (const l of cl) for (const r of cr) {
    const [pl, pr] = closestPoints(l.a, l.b, r.a, r.b), diff = pl.clone().sub(pr), distance = diff.length();
    const depth = l.r + r.r - distance;
    if (depth > 0) out.push({ depth, normal: distance > 1e-6 ? diff.divideScalar(distance) : fallback.clone(), left: l.part, right: r.part });
  }
  return out;
}
/** The deepest overlap between the two hands' volumes, or null when they do not overlap. */
export function deepestPenetration(left: HandState, right: HandState, fallback: Vector3): Penetration | null {
  return overlaps(left, right, fallback).reduce<Penetration | null>((best, p) => !best || p.depth > best.depth ? p : best, null);
}

export type Separation = { shift: Record<Side, Vector3>; direction: Vector3; before: number; after: number };
/** Surfaces this close count as touching; separation stops there instead of opening a visible gap. */
export const TOUCH_METERS = .0005;
const centroid = (hand: HandState, side: Side) => handCapsules(hand, side).reduce((sum, c) => sum.add(c.a).add(c.b), new Vector3()).divideScalar(2 * handCapsules(hand, side).length);
const moved = (hand: HandState, by: Vector3): HandState => ({ ...hand, wrist: hand.wrist.clone().add(by) });

/**
 * Moves the hands apart along one direction (rigidly: wrist translation only, palm orientation and fingers unchanged)
 * by the smallest distance at which their volumes no longer overlap, so hands that should touch meet at their surfaces
 * instead of passing into each other. The direction is the depth-weighted mean of the overlap normals (else the line
 * between the hands' centers, else the torso's lateral axis), projected onto `axis` when one is given; `share` splits
 * the move (1 = only the left hand moves).
 * The hands are updated in place.
 */
export function separateHands(left: HandState, right: HandState, fallback: Vector3, share = .5, axis?: Vector3): Separation {
  const found = overlaps(left, right, fallback), shift = { left: new Vector3(), right: new Vector3() };
  const before = found.reduce((m, p) => Math.max(m, p.depth), 0);
  const direction = found.reduce((sum, p) => sum.addScaledVector(p.normal, p.depth), new Vector3());
  // Mirror-symmetric hands separate along the given axis only, so the separation keeps them symmetric.
  if (axis && Math.abs(direction.dot(axis)) > 1e-6) direction.copy(axis).multiplyScalar(Math.sign(direction.dot(axis)));
  if (direction.lengthSq() < 1e-10) direction.copy(centroid(left, 'left').sub(centroid(right, 'right')));
  if (direction.lengthSq() < 1e-10) direction.copy(fallback);
  direction.normalize();
  if (before <= TOUCH_METERS) return { shift, direction, before, after: before };
  const depthAt = (distance: number) => {
    const d = direction.clone().multiplyScalar(distance);
    return deepestPenetration(moved(left, d.clone().multiplyScalar(share)), moved(right, d.clone().multiplyScalar(share - 1)), fallback)?.depth ?? 0;
  };
  // Grow until clear, then bisect down to the touching distance.
  let lo = 0, hi = before + TOUCH_METERS;
  while (depthAt(hi) > TOUCH_METERS && hi < .5) { lo = hi; hi *= 2; }
  for (let k = 0; k < 24 && hi - lo > 1e-4; k++) { const mid = (lo + hi) / 2; if (depthAt(mid) > TOUCH_METERS) lo = mid; else hi = mid; }
  shift.left.copy(direction).multiplyScalar(hi * share); shift.right.copy(direction).multiplyScalar(-hi * (1 - share));
  left.wrist.add(shift.left); right.wrist.add(shift.right);
  return { shift, direction, before, after: depthAt(hi) > TOUCH_METERS ? depthAt(hi) : deepestPenetration(left, right, fallback)?.depth ?? 0 };
}

/** Re-solves one arm of a pose so its wrist reaches `wrist`, keeping the world palm (fixed-length IK, original elbow as pole). */
export function moveWrist(pose: DisplayPose, side: Side, wrist: Vector3) {
  const before = forwardArm(pose, side), torso = q(pose.rotations.torso).normalize();
  const arm = solveArm(before.shoulder, wrist, before.elbow);
  const { forearm, wrist: local } = distributeForearmRoll(arm.lowerQ, before.palm);
  pose.rotations[`${side}.upper`] = qa(torso.invert().multiply(arm.upperQ));
  pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(forearm));
  pose.rotations[`${side}.wrist`] = qa(local);
  return arm.wrist.distanceTo(wrist);
}

/** Lateral axis of the torso pointing to the signer's left: the fallback push for coincident volumes. */
export const leftward = (pose: DisplayPose) => new Vector3(1, 0, 0).applyQuaternion(q(pose.rotations.torso));
export const handsOf = (pose: DisplayPose) => Object.fromEntries(SIDES.map(side => [side, handState(pose, side)])) as Record<Side, HandState>;
