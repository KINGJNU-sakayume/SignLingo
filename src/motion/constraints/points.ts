import { Quaternion, Vector3 } from 'three';
import { q, v } from '../math';
import { fingerLengths, fingerOffsets, forwardArm } from '../rig';
import { FINGERS, type Pose, type Side } from '../types';
import type { BodyPoint, Finger, FingerSite, HandSite, PointName } from './names';

/** A hand as the solver moves it: world wrist position, world palm orientation and finger-local rotations. */
export type HandState = { wrist: Vector3; palm: Quaternion; fingers: Record<string, Quaternion> };
export const fingerKeys = (side: Side) => FINGERS.flatMap(f => [0, 1, 2].map(j => `${side}.${f}.${j}`));

export function handState(pose: Pose, side: Side): HandState {
  const arm = forwardArm(pose, side);
  return { wrist: arm.wrist, palm: arm.palm, fingers: Object.fromEntries(fingerKeys(side).map(key => [key, q(pose.rotations[key])])) };
}
export const cloneHand = (h: HandState): HandState =>
  ({ wrist: h.wrist.clone(), palm: h.palm.clone(), fingers: Object.fromEntries(Object.entries(h.fingers).map(([k, r]) => [k, r.clone()])) });

/** Finger chain [base, mid, distal start, tip], the same +Y bone hierarchy as forwardHand() and Avatar.tsx. */
export function fingerChain(hand: HandState, side: Side, finger: Finger): Vector3[] {
  const offset = new Vector3(...fingerOffsets[finger]);
  if (side === 'right') offset.x *= -1;
  let position = offset.applyQuaternion(hand.palm).add(hand.wrist);
  const orientation = hand.palm.clone(), points = [position.clone()];
  for (let j = 0; j < 3; j++) {
    orientation.multiply(hand.fingers[`${side}.${finger}.${j}`]);
    position = position.clone().addScaledVector(new Vector3(0, 1, 0).applyQuaternion(orientation), fingerLengths[finger][j]);
    points.push(position.clone());
  }
  return points;
}

// Palm-local surface points of the avatar hand (palm ellipsoid at +0.042 m, half thickness 0.014 m; +z is the
// palm side, the side fingers flex toward). Left hand; the right hand mirrors x, like the rig's finger offsets.
const SITES: Record<Exclude<HandSite, 'wrist'>, [number, number, number]> = {
  palm: [0, .042, .014], back: [0, .042, -.014], pinkyEdge: [.037, .042, 0], indexEdge: [-.037, .042, 0],
};
export function handPoint(hand: HandState, side: Side, site: HandSite | `${Finger}.${FingerSite}`): Vector3 {
  if (site === 'wrist') return hand.wrist.clone();
  if (site in SITES) {
    const local = new Vector3(...SITES[site as keyof typeof SITES]);
    if (side === 'right') local.x *= -1;
    return local.applyQuaternion(hand.palm).add(hand.wrist);
  }
  const [finger, part] = site.split('.') as [Finger, FingerSite];
  return fingerChain(hand, side, finger)[part === 'base' ? 0 : part === 'mid' ? 1 : 3];
}

// Approximate landmarks on the avatar's upper body mesh (torso ellipsoid centered 0.2 m below the shoulder line,
// head group 0.105 m above it). They are avatar geometry, not measured face or body positions.
const TORSO_POINTS: Partial<Record<BodyPoint, [number, number, number]>> = {
  'body.chest': [0, -.10, .113], 'body.belly': [0, -.32, .109], 'body.leftShoulder': [.19, 0, 0], 'body.rightShoulder': [-.19, 0, 0],
};
const HEAD_POINTS: Partial<Record<BodyPoint, [number, number, number]>> = {
  'head.forehead': [0, .17, .071], 'head.nose': [0, .105, .1], 'head.mouth': [0, .05, .079], 'head.chin': [0, 0, .048],
  'head.left': [.09, .11, 0], 'head.right': [-.09, .11, 0],
};
export function bodyPoint(pose: Pose, name: BodyPoint): Vector3 {
  const torso = q(pose.rotations.torso), root = v(pose.root);
  const local = TORSO_POINTS[name];
  if (local) return new Vector3(...local).applyQuaternion(torso).add(root);
  const head = new Vector3(...HEAD_POINTS[name]!).applyQuaternion(q(pose.rotations.head)).add(new Vector3(0, .105, 0));
  return head.applyQuaternion(torso).add(root);
}
export function pointPosition(pose: Pose, hands: Record<Side, HandState>, name: PointName): Vector3 {
  if (name.startsWith('head.') || name.startsWith('body.')) return bodyPoint(pose, name as BodyPoint);
  const side = name.startsWith('left.') ? 'left' : 'right';
  return handPoint(hands[side], side, name.slice(side.length + 1) as HandSite);
}
