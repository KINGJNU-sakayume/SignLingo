import { Matrix4, Quaternion, Vector3 } from 'three';
import { boneQuaternion, boundWrist, eulerQuat, q, qa, rad, REACH, solveArm, v } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { SIDES, type ConstraintEvidence, type DisplayPose, type MotionClip, type Quat, type Side } from '../types';
import { armVisible } from '../display/pipeline';
import { chordalMean } from '../display/quaternion';
import { signingInterval } from '../signing';
import { separateHands, TOUCH_METERS } from '../handContact';
import { pointSide, type Direction, type Facing, type PointName } from './names';
import { cloneHand, fingerKeys, handPoint, handState, pointPosition, type HandState } from './points';
import { presetRotations } from './presets';
import type { Constraint, ConstraintKind, ConstraintSet } from './schema';
import { blendWeight, resolveSpan, type ResolvedSpan, type SigningInterval } from './spans';

/** What the source shows of a hand at a frame: an observation, a short hold (no measurement), or nothing. */
export type HandSource = 'observed' | 'held' | 'missing';
export type SolveInput = {
  /** Used only for the signing interval of phase/fraction spans (`signingInterval`: hands raised from rest). */
  clip: MotionClip;
  poses: readonly DisplayPose[];
  timestamps: readonly number[];
  hands: (index: number, side: Side) => HandSource;
  /** Arms the avatar shows; constraints never create a hidden arm. Default: the display rule (`armVisible`). */
  armShown?: (index: number, side: Side) => boolean;
  set: ConstraintSet;
  interval?: SigningInterval;
};
export type ResidualUnit = 'm' | 'deg';
/**
 * `unavailable`: a needed arm or hand is not shown (position constraints also skip hands with no observation);
 * `unreachable`: the fixed-length arm cannot reach; `capped`: the move hit `maxShiftCm`; `limited`: the wrist joint limit stopped the turn;
 * `blocked`: other parts of the two hands touched first, and the hands were kept from passing into each other.
 */
export type FrameStatus = 'ok' | 'unavailable' | 'no-torso' | 'unreachable' | 'capped' | 'limited' | 'blocked';
export type ResidualRow = { weight: number; core: boolean; before: number | null; after: number | null; status: FrameStatus };
export type Stats = { max: number | null; mean: number | null };
export type ConstraintSummary = {
  activeFrames: number; coreFrames: number; measuredCoreFrames: number;
  unavailableFrames: number; unreachableFrames: number; cappedFrames: number; limitedFrames: number; blockedFrames: number;
  /** Over measured core frames (blend weight 1); `null` when nothing could be measured. */
  before: Stats; after: Stats; satisfiedBefore: number; satisfiedAfter: number;
};
export type ConstraintResult = {
  id: string; kind: ConstraintKind; note: string; unit: ResidualUnit;
  /** Residual at or below this counts as satisfied (same unit). */
  tolerance: number;
  span: ResolvedSpan | null;
  rows: (ResidualRow | null)[];
  summary: ConstraintSummary;
};
export type FrameChange = {
  index: number; timestamp: number;
  applied: { id: string; weight: number }[];
  /** Rig joints whose rotation changed. */
  joints: string[];
  /** Per changed hand: `observed` = an observed hand was adjusted; `constrained` = the hand had no observation here. */
  evidence: Partial<Record<Side, ConstraintEvidence>>;
  /** Hands whose finger rotations a constraint set at this frame. */
  fingers: Partial<Record<Side, boolean>>;
};
export type ConstraintSolution = { poses: DisplayPose[]; changes: FrameChange[]; constraints: ConstraintResult[]; interval: SigningInterval };

const PASSES = 6;
const ORIENTATION_ORDER: ConstraintKind[] = ['hold', 'handshape', 'palmFacing', 'wristOffset', 'symmetry'];
const POSITION_KINDS: ConstraintKind[] = ['hold', 'symmetry', 'sameHeight', 'contact'];
const SATISFIED: Record<ConstraintKind, (c: Constraint) => number> = {
  sameHeight: c => (c as Extract<Constraint, { kind: 'sameHeight' }>).toleranceCm / 100,
  contact: c => (c as Extract<Constraint, { kind: 'contact' }>).toleranceCm / 100,
  symmetry: c => (c as Extract<Constraint, { kind: 'symmetry' }>).toleranceCm / 100,
  handshape: () => 2,
  palmFacing: c => (c as Extract<Constraint, { kind: 'palmFacing' }>).toleranceDeg + .5,
  hold: c => (c as Extract<Constraint, { kind: 'hold' }>).parts.includes('position') ? .005 : 2,
  wristOffset: () => 1,
};
const unitOf = (c: Constraint): ResidualUnit =>
  c.kind === 'sameHeight' || c.kind === 'contact' || c.kind === 'symmetry' || (c.kind === 'hold' && c.parts.includes('position')) ? 'm' : 'deg';
const sidesOf = (hand: 'left' | 'right' | 'both'): Side[] => hand === 'both' ? [...SIDES] : [hand];
const deg = (radians: number) => radians * 180 / Math.PI;
const mirror = (r: Quaternion) => new Quaternion(r.x, -r.y, -r.z, r.w);
const spanBasis = (clip: MotionClip): SigningInterval => { const { start, end, method } = signingInterval(clip); return { start, end, method }; };
const DIRECTIONS: Record<Exclude<Direction, 'inward' | 'outward'>, [number, number, number]> = {
  up: [0, 1, 0], down: [0, -1, 0], forward: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0],
};
/** A torso-frame direction in world space; inward points to the body midline (the signer's right for the left hand). */
function directionVector(name: Direction, side: Side, torso: Quaternion): Vector3 {
  const toward = side === 'left' ? -1 : 1;
  const local = name === 'inward' ? [toward, 0, 0] : name === 'outward' ? [-toward, 0, 0] : DIRECTIONS[name];
  return new Vector3(...local).applyQuaternion(torso).normalize();
}
/** Orientation whose +Z (palm normal) is `z` and +Y (fingers) is `y` orthogonalized against it. */
function frame(y: Vector3, z: Vector3) {
  const x = y.clone().cross(z).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize();
}

type Frame = {
  pose: DisplayPose; torso: Quaternion; root: Vector3;
  shown: Record<Side, boolean>; source: Record<Side, HandSource>;
  hands: Record<Side, HandState>;
  fingersSet: Record<Side, boolean>; orientationSet: Record<Side, boolean>;
};
const handAvailable = (f: Frame, side: Side) => f.shown[side] && (f.source[side] !== 'missing' || f.fingersSet[side]);
/** Position constraints move only hands that were observed or briefly held here: no movement is invented for unseen hands. */
const handPresent = (f: Frame, side: Side) => f.shown[side] && f.source[side] !== 'missing';
const presentFor = (f: Frame, points: PointName[]) => points.every(p => { const side = pointSide(p); return !side || handPresent(f, side); });
function pointAvailable(f: Frame, name: PointName) {
  const side = pointSide(name);
  if (!side) return true;
  return name === `${side}.wrist` ? f.shown[side] : handAvailable(f, side);
}
const local = (f: Frame, world: Vector3) => world.clone().sub(f.root).applyQuaternion(f.torso.clone().invert());

/** Residual of one constraint on a frame state, or null when a needed hand is not available. */
function measure(c: Constraint, f: Frame, context: { hold?: Partial<Record<Side, HoldReference>>; offsetFrom?: Partial<Record<Side, Quaternion>> }): number | null {
  switch (c.kind) {
    case 'sameHeight': {
      if (!c.points.every(p => pointAvailable(f, p)) || !presentFor(f, c.points)) return null;
      const ys = c.points.map(p => pointPosition(f.pose, f.hands, p).y);
      return Math.max(...ys) - Math.min(...ys);
    }
    case 'contact': {
      if (!pointAvailable(f, c.a) || !pointAvailable(f, c.b) || !presentFor(f, [c.a, c.b])) return null;
      return Math.max(0, pointPosition(f.pose, f.hands, c.a).distanceTo(pointPosition(f.pose, f.hands, c.b)) - c.gapCm / 100);
    }
    case 'symmetry': {
      if (!handPresent(f, 'left') || !handPresent(f, 'right')) return null;
      return symmetryTargets(c, f).residual;
    }
    case 'handshape': {
      const sides = sidesOf(c.hand);
      if (!sides.every(side => handAvailable(f, side))) return null;
      return Math.max(...sides.map(side => {
        const target = presetRotations(c.preset, side, c.fingers), keys = Object.keys(target);
        return keys.reduce((sum, key) => sum + deg(f.hands[side].fingers[key].angleTo(target[key])), 0) / keys.length;
      }));
    }
    case 'palmFacing': {
      const sides = sidesOf(c.hand);
      if (!sides.every(side => f.shown[side]) || (c.facing === 'other-hand' && !(f.shown.left && f.shown.right))) return null;
      return Math.max(...sides.map(side => facingTarget(c, f, side).residual));
    }
    case 'hold': {
      const sides = sidesOf(c.hand).filter(side => context.hold?.[side]);
      if (!sides.length || !sides.every(side => c.parts.includes('position') ? handPresent(f, side) : f.shown[side])) return null;
      return Math.max(...sides.map(side => {
        const ref = context.hold![side]!, hand = f.hands[side];
        if (c.parts.includes('position')) return hand.wrist.distanceTo(ref.wrist);
        if (c.parts.includes('orientation') && ref.palm) return deg(hand.palm.angleTo(ref.palm));
        if (ref.fingers && handAvailable(f, side)) return Object.entries(ref.fingers).reduce((sum, [key, r]) => sum + deg(hand.fingers[key].angleTo(r)), 0) / 15;
        return 0;
      }));
    }
    case 'wristOffset': {
      const from = context.offsetFrom?.[c.hand];
      if (!f.shown[c.hand] || !from) return null;
      const target = from.clone().multiply(new Quaternion().slerp(offsetQuaternion(c), c.strength));
      return deg(f.hands[c.hand].palm.angleTo(target));
    }
  }
}
/**
 * Residual of a handshape or palmFacing constraint on one pose, exactly as the solver measures it (null when a needed
 * hand is not shown or has no observation). Other kinds need clip context (holds, offsets) or depend on the fixed rig's
 * arm geometry and monocular depth, so they are not measured here. Used by Practice to grade a learner's tracked frames.
 */
export function orientationResidual(c: Constraint, pose: DisplayPose, shown: Record<Side, boolean>, source: Record<Side, HandSource>): number | null {
  if (c.kind !== 'handshape' && c.kind !== 'palmFacing') return null;
  if (pose.quality.body <= 0) return null;
  const f: Frame = { pose, torso: q(pose.rotations.torso).normalize(), root: v(pose.root), shown, source,
    hands: { left: handState(pose, 'left'), right: handState(pose, 'right') },
    fingersSet: { left: false, right: false }, orientationSet: { left: false, right: false } };
  if (c.kind === 'palmFacing' && !sidesOf(c.hand).every(side => handPresent(f, side))) return null;
  return measure(c, f, {});
}
const offsetQuaternion = (c: Extract<Constraint, { kind: 'wristOffset' }>) => eulerQuat(...c.degrees.map(rad) as [number, number, number]);

function facingTarget(c: Extract<Constraint, { kind: 'palmFacing' }>, f: Frame, side: Side) {
  const hand = f.hands[side], other: Side = side === 'left' ? 'right' : 'left';
  const d = c.facing === 'other-hand'
    ? handPoint(f.hands[other], other, 'palm').sub(handPoint(hand, side, 'palm')).normalize()
    : directionVector(c.facing as Direction, side, f.torso);
  const normal = new Vector3(0, 0, 1).applyQuaternion(hand.palm), fingers = new Vector3(0, 1, 0).applyQuaternion(hand.palm);
  let target = new Quaternion().setFromUnitVectors(normal, d).multiply(hand.palm).normalize(), residual = deg(normal.angleTo(d));
  if (c.pointing) {
    const e = directionVector(c.pointing, side, f.torso), y = e.clone().addScaledVector(d, -e.dot(d));
    // Pointing along the palm normal is contradictory; only the facing is used then.
    if (y.length() > .2) {
      y.normalize(); target = frame(y, d);
      residual = Math.max(residual, deg(fingers.angleTo(y)));
    }
  }
  return { target, residual };
}

function symmetryTargets(c: Extract<Constraint, { kind: 'symmetry' }>, f: Frame) {
  const pl = local(f, f.hands.left.wrist), pr = local(f, f.hands.right.wrist);
  // Where the other hand belongs: lateral = mirror image across the body midline; vertical = same left-right and
  // depth (one hand above the other); depth = same left-right and height (one in front). The free coordinate
  // (vertical: height, depth: depth) keeps the hand's own value.
  const counterpart = (p: Vector3, own: Vector3) => {
    const t = c.axis === 'lateral' ? new Vector3(-p.x, p.y, p.z) : p.clone();
    if (c.axis === 'vertical') t.y = own.y;
    if (c.axis === 'depth') t.z = own.z;
    return t;
  };
  const residual = counterpart(pl, pr).distanceTo(pr);
  let tl = pl, tr = pr;
  if (c.lead === 'left') tr = counterpart(pl, pr);
  else if (c.lead === 'right') tl = counterpart(pr, pl);
  else { tr = pr.clone().add(counterpart(pl, pr)).multiplyScalar(.5); tl = counterpart(tr, pl); }
  return { left: tl, right: tr, residual };
}

type HoldReference = { wrist: Vector3; palm?: Quaternion; fingers?: Record<string, Quaternion> };
function holdReferences(c: Extract<Constraint, { kind: 'hold' }>, span: ResolvedSpan, input: SolveInput, shown: (i: number, side: Side) => boolean) {
  const refs: Partial<Record<Side, HoldReference>> = {};
  for (const side of sidesOf(c.hand)) {
    const indices: number[] = [];
    for (let i = span.firstFrame; i <= span.lastFrame; i++) if (input.poses[i].quality.body > 0 && shown(i, side)) indices.push(i);
    if (!indices.length) continue;
    const observed = indices.filter(i => input.hands(i, side) === 'observed');
    const pick = (list: number[]) => c.reference === 'start' ? [list[0]] : c.reference === 'end' ? [list.at(-1)!] : list;
    const states = (list: number[]) => pick(list).map(i => handState(input.poses[i], side));
    // Positions come from frames where the hand was seen (observed or held) when there are any, like the moves themselves.
    const present = indices.filter(i => input.hands(i, side) !== 'missing');
    const positions = states(present.length ? present : indices);
    const ref: HoldReference = { wrist: positions.reduce((sum, h) => sum.add(h.wrist), new Vector3()).divideScalar(positions.length) };
    if (observed.length) {
      const hands = states(observed);
      ref.palm = chordalMean(hands.map(h => h.palm));
      ref.fingers = Object.fromEntries(fingerKeys(side).map(key => [key, chordalMean(hands.map(h => h.fingers[key]))]));
    }
    refs[side] = ref;
  }
  return refs;
}

function bareForearm(pose: DisplayPose, side: Side) {
  const arm = forwardArm(pose, side);
  const upper = arm.elbow.clone().sub(arm.shoulder), lower = arm.wrist.clone().sub(arm.elbow);
  return { arm, bare: boneQuaternion(lower, upper.clone().cross(lower).normalize()) };
}
const sameQuat = (a: Quat, b: Quat) => a.every((x, k) => Math.abs(x - b[k]) < 1e-12);

/**
 * Applies a constraint set to whole-clip poses. Pure: the input is read only and unchanged frames are returned
 * as the same objects. Per frame, orientation constraints adjust the hands (fixed order, slerp by blend weight),
 * position constraints move wrist targets (Gauss–Seidel passes projected onto the fixed arm's reach), and each
 * changed arm is re-solved with the existing fixed-length two-bone IK (`solveArm`, the old elbow as pole) and the
 * reconstruction's roll allocation (`distributeForearmRoll`). Residuals are measured from the final rig.
 */
export function solveConstraints(input: SolveInput): ConstraintSolution {
  const { poses, timestamps, set } = input;
  const interval = input.interval ?? spanBasis(input.clip);
  const shown = input.armShown ?? ((i: number, side: Side) => armVisible(poses[i], side));
  const spans = set.constraints.map(c => resolveSpan(c.span, timestamps, interval));
  const holds = set.constraints.map((c, k) => c.kind === 'hold' && spans[k] ? holdReferences(c, spans[k]!, input, shown) : undefined);
  const rows: (ResidualRow | null)[][] = set.constraints.map(() => []);
  const changes: FrameChange[] = [];
  const out = poses.map((pose, i) => {
    const t = timestamps[i];
    const active = set.constraints.flatMap((c, k) => {
      const span = spans[k]; if (!span) return [];
      const blend = blendWeight(t, span, c.blendMs);
      return blend > 0 ? [{ c, k, blend, w: blend * c.strength }] : [];
    });
    set.constraints.forEach((_, k) => { rows[k][i] = null; });
    if (!active.length) return pose;
    if (pose.quality.body <= 0) {
      for (const { k, w, blend } of active) rows[k][i] = { weight: w, core: blend >= 1, before: null, after: null, status: 'no-torso' };
      return pose;
    }
    const torso = q(pose.rotations.torso).normalize(), root = v(pose.root);
    const f: Frame = {
      pose, torso, root,
      shown: { left: shown(i, 'left'), right: shown(i, 'right') },
      source: { left: input.hands(i, 'left'), right: input.hands(i, 'right') },
      hands: { left: handState(pose, 'left'), right: handState(pose, 'right') },
      fingersSet: { left: false, right: false }, orientationSet: { left: false, right: false },
    };
    const before = { left: cloneHand(f.hands.left), right: cloneHand(f.hands.right) };
    const offsetFrom = { left: before.left.palm.clone(), right: before.right.palm.clone() };
    const contexts = active.map(({ k }) => ({ hold: holds[k], offsetFrom }));
    const residualBefore = active.map(({ c }, n) => measure(c, { ...f, hands: before, fingersSet: { left: false, right: false } }, contexts[n]));

    // Orientation and handshape, in a fixed kind order.
    for (const kind of ORIENTATION_ORDER) for (const [n, { c, w }] of active.entries()) {
      if (c.kind !== kind) continue;
      if (c.kind === 'handshape') for (const side of sidesOf(c.hand)) {
        if (!f.shown[side]) continue;
        const target = presetRotations(c.preset, side, c.fingers), fresh = f.source[side] === 'missing' && !f.fingersSet[side];
        // A missing hand has no observed fingers to blend from: it takes the preset wherever the span is active.
        for (const [key, r] of Object.entries(target)) f.hands[side].fingers[key] = fresh ? r.clone() : f.hands[side].fingers[key].clone().slerp(r, w);
        f.fingersSet[side] = true;
      } else if (c.kind === 'palmFacing') for (const side of sidesOf(c.hand)) {
        if (!f.shown[side] || (c.facing === 'other-hand' && !(f.shown.left && f.shown.right))) continue;
        const { target, residual } = facingTarget(c, f, side);
        if (residual <= c.toleranceDeg) continue;
        const goal = f.hands[side].palm.clone().slerp(target, (residual - c.toleranceDeg) / residual);
        f.hands[side].palm.slerp(goal, w).normalize();
        f.orientationSet[side] = true;
      } else if (c.kind === 'wristOffset') {
        if (!f.shown[c.hand]) continue;
        f.hands[c.hand].palm.multiply(new Quaternion().slerp(offsetQuaternion(c), w)).normalize();
        f.orientationSet[c.hand] = true;
      } else if (c.kind === 'hold') for (const side of sidesOf(c.hand)) {
        const ref = contexts[n].hold?.[side];
        if (!ref || !f.shown[side]) continue;
        if (c.parts.includes('orientation') && ref.palm) { f.hands[side].palm.slerp(ref.palm, w).normalize(); f.orientationSet[side] = true; }
        if (c.parts.includes('handshape') && ref.fingers) {
          for (const [key, r] of Object.entries(ref.fingers)) f.hands[side].fingers[key].slerp(r, w).normalize();
          f.fingersSet[side] = true;
        }
      } else if (c.kind === 'symmetry' && (c.orientation ?? c.axis === 'lateral') && c.axis === 'lateral' && f.shown.left && f.shown.right) {
        // Palms only: mirror images in the torso frame. Fingers are left to handshape constraints.
        const inverse = f.torso.clone().invert();
        const ql = inverse.clone().multiply(f.hands.left.palm), qr = inverse.clone().multiply(f.hands.right.palm);
        let tl = ql, tr = qr;
        if (c.lead === 'left') tr = mirror(ql); else if (c.lead === 'right') tl = mirror(qr);
        else { tr = qr.clone().slerp(mirror(ql), .5); tl = mirror(tr); }
        f.hands.left.palm.slerp(f.torso.clone().multiply(tl), w).normalize();
        f.hands.right.palm.slerp(f.torso.clone().multiply(tr), w).normalize();
        f.orientationSet.left = f.orientationSet.right = true;
      }
    }

    // Wrist positions: iterate, then blend each side by the strongest position constraint acting on it.
    const start = { left: f.hands.left.wrist.clone(), right: f.hands.right.wrist.clone() };
    const shoulders = { left: forwardArm(pose, 'left').shoulder, right: forwardArm(pose, 'right').shoulder };
    const sideWeight = { left: 0, right: 0 }, sideCap = { left: Infinity, right: Infinity };
    const positional = active.map((a, n) => ({ ...a, n })).filter(({ c }) => POSITION_KINDS.includes(c.kind) && (c.kind !== 'hold' || c.parts.includes('position')));
    for (let pass = 0; pass < PASSES && positional.length; pass++) for (const { c, w, n } of positional) {
      const corrections = positionCorrection(c, f, contexts[n].hold);
      for (const side of SIDES) {
        const correction = corrections[side];
        if (!correction || correction.lengthSq() < 1e-18 || !f.shown[side]) continue;
        const wrist = f.hands[side].wrist.add(correction), reach = wrist.clone().sub(shoulders[side]);
        const length = Math.min(REACH.max, Math.max(REACH.min, reach.length()));
        if (reach.length() > 1e-9) wrist.copy(shoulders[side]).addScaledVector(reach.normalize(), length);
        sideWeight[side] = Math.max(sideWeight[side], w);
        sideCap[side] = Math.min(sideCap[side], (c as { maxShiftCm: number }).maxShiftCm / 100);
      }
    }
    const capped = { left: false, right: false };
    for (const side of SIDES) {
      const shift = f.hands[side].wrist.clone().sub(start[side]).multiplyScalar(sideWeight[side]);
      if (shift.length() > sideCap[side] + 1e-12) { shift.setLength(sideCap[side]); capped[side] = true; }
      f.hands[side].wrist = start[side].clone().add(shift);
    }
    // The hands never pass into each other: where their volumes overlap after the moves above, both shown hands
    // move apart (equal shares) until their surfaces touch. A contact therefore ends at the first touching surfaces.
    const lateral = new Vector3(1, 0, 0).applyQuaternion(torso);
    const mirrored = active.some(({ c }) => c.kind === 'symmetry' && c.axis === 'lateral');
    const blocked = handAvailable(f, 'left') && handAvailable(f, 'right')
      && separateHands(f.hands.left, f.hands.right, lateral, .5, mirrored ? lateral : undefined).before > TOUCH_METERS;

    // Re-solve changed arms.
    const rotations = { ...pose.rotations }, flags = { left: new Set<FrameStatus>(), right: new Set<FrameStatus>() };
    for (const side of SIDES) { if (capped[side]) flags[side].add('capped'); if (blocked) flags[side].add('blocked'); }
    for (const side of SIDES) {
      const hand = f.hands[side], old = before[side];
      const moved = hand.wrist.distanceTo(old.wrist) > 1e-9, turned = hand.palm.angleTo(old.palm) > 1e-9;
      const fingers = fingerKeys(side).filter(key => hand.fingers[key].angleTo(old.fingers[key]) > 1e-9);
      if (!f.shown[side] || (!moved && !turned && !fingers.length)) continue;
      if (moved || turned) {
        const { arm, bare } = bareForearm(pose, side);
        let upper = arm.upper, lower = bare;
        if (moved) {
          const solved = solveArm(arm.shoulder, hand.wrist, arm.elbow);
          upper = solved.upperQ; lower = solved.lowerQ;
          if (solved.wrist.distanceTo(hand.wrist) > .002) flags[side].add('unreachable');
          rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(upper));
        }
        const { forearm, wrist } = distributeForearmRoll(lower, hand.palm);
        let local = wrist;
        if (f.orientationSet[side]) {
          const bounded = boundWrist(wrist);
          if (bounded.correction > rad(.5)) flags[side].add('limited');
          local = bounded.rotation;
        }
        rotations[`${side}.lower`] = qa(upper.clone().invert().multiply(forearm));
        rotations[`${side}.wrist`] = qa(local);
      }
      for (const key of fingers) rotations[key] = qa(hand.fingers[key].normalize());
    }
    const joints = Object.keys(rotations).filter(key => !sameQuat(rotations[key], pose.rotations[key]));
    const next: DisplayPose = joints.length ? { ...pose, rotations } : pose;
    const after: Frame = { ...f, pose: next, hands: { left: handState(next, 'left'), right: handState(next, 'right') } };
    active.forEach(({ c, k, w, blend }, n) => {
      const value = measure(c, after, contexts[n]);
      // Reach and the move cap concern position constraints; the wrist limit concerns orientation constraints.
      const involved = involvedSides(c), positional = POSITION_KINDS.includes(c.kind) && (c.kind !== 'hold' || c.parts.includes('position'));
      const oriented = c.kind === 'palmFacing' || c.kind === 'wristOffset' || c.kind === 'symmetry' || (c.kind === 'hold' && c.parts.includes('orientation'));
      const has = (flag: FrameStatus) => involved.some(side => flags[side].has(flag));
      const status: FrameStatus = value === null ? 'unavailable' : positional && has('unreachable') ? 'unreachable' : positional && has('capped') ? 'capped'
        : positional && has('blocked') ? 'blocked' : oriented && has('limited') ? 'limited' : 'ok';
      rows[k][i] = { weight: w, core: blend >= 1, before: residualBefore[n], after: value, status };
    });
    if (!joints.length) return pose;
    const evidence: FrameChange['evidence'] = {}, fingers: FrameChange['fingers'] = {};
    for (const side of SIDES) {
      if (!joints.some(j => j.startsWith(`${side}.`))) continue;
      evidence[side] = f.source[side] === 'observed' ? 'observed' : 'constrained';
      if (joints.some(j => j.startsWith(`${side}.`) && j.split('.').length === 3)) fingers[side] = true;
    }
    changes.push({ index: i, timestamp: t, applied: active.map(({ c, w }) => ({ id: c.id, weight: w })), joints, evidence, fingers });
    return next;
  });
  const constraints = set.constraints.map((c, k): ConstraintResult => {
    const tolerance = SATISFIED[c.kind](c);
    return { id: c.id, kind: c.kind, note: c.note, unit: unitOf(c), tolerance, span: spans[k], rows: rows[k], summary: summarize(rows[k], tolerance) };
  });
  return { poses: out, changes, constraints, interval };
}

function involvedSides(c: Constraint): Side[] {
  switch (c.kind) {
    case 'sameHeight': return [...new Set(c.points.flatMap(p => pointSide(p) ?? []))];
    case 'contact': return [...new Set([c.a, c.b].flatMap(p => pointSide(p) ?? []))];
    case 'symmetry': return [...SIDES];
    case 'wristOffset': return [c.hand];
    default: return sidesOf(c.hand);
  }
}

/** Wrist translation each moving hand needs for one position constraint, from the current state. */
function positionCorrection(c: Constraint, f: Frame, hold?: Partial<Record<Side, HoldReference>>): Partial<Record<Side, Vector3>> {
  const out: Partial<Record<Side, Vector3>> = {};
  const moves = (side: Side | null, who: 'both' | 'left' | 'right') => !!side && handPresent(f, side) && (who === 'both' || who === side);
  if (c.kind === 'sameHeight') {
    if (!c.points.every(p => pointAvailable(f, p)) || !presentFor(f, c.points)) return out;
    const points = c.points.map(p => ({ side: pointSide(p), y: pointPosition(f.pose, f.hands, p).y }));
    const movable = points.filter(p => moves(p.side, c.move)), fixed = points.filter(p => !moves(p.side, c.move));
    if (!movable.length) return out;
    const reference = fixed.length ? fixed : points, height = reference.reduce((s, p) => s + p.y, 0) / reference.length;
    const half = c.toleranceCm / 200, per: Partial<Record<Side, number[]>> = {};
    for (const p of movable) {
      const d = height - p.y, excess = Math.sign(d) * Math.max(0, Math.abs(d) - half);
      (per[p.side!] ??= []).push(excess);
    }
    for (const side of SIDES) if (per[side]) out[side] = new Vector3(0, per[side]!.reduce((a, b) => a + b, 0) / per[side]!.length, 0);
  } else if (c.kind === 'contact') {
    if (!pointAvailable(f, c.a) || !pointAvailable(f, c.b) || !presentFor(f, [c.a, c.b])) return out;
    const a = pointPosition(f.pose, f.hands, c.a), b = pointPosition(f.pose, f.hands, c.b), diff = b.clone().sub(a);
    const distance = diff.length(), excess = Math.max(0, distance - c.gapCm / 100 - c.toleranceCm / 100);
    if (excess <= 0 || distance < 1e-9) return out;
    diff.normalize();
    const sa = pointSide(c.a), sb = pointSide(c.b), ma = moves(sa, c.move), mb = moves(sb, c.move);
    const share = ma && mb ? .5 : 1;
    if (ma) out[sa!] = diff.clone().multiplyScalar(excess * share);
    if (mb) out[sb!] = diff.clone().multiplyScalar(-excess * share);
  } else if (c.kind === 'symmetry') {
    if (!handPresent(f, 'left') || !handPresent(f, 'right')) return out;
    const targets = symmetryTargets(c, f);
    const excess = Math.max(0, targets.residual - c.toleranceCm / 100);
    if (excess <= 0) return out;
    const scale = excess / targets.residual;
    for (const side of SIDES) {
      const current = local(f, f.hands[side].wrist), delta = targets[side].clone().sub(current).multiplyScalar(scale).applyQuaternion(f.torso);
      if (delta.lengthSq() > 0) out[side] = delta;
    }
  } else if (c.kind === 'hold') {
    for (const side of sidesOf(c.hand)) if (hold?.[side] && handPresent(f, side)) out[side] = hold[side]!.wrist.clone().sub(f.hands[side].wrist);
  }
  return out;
}

function summarize(rows: (ResidualRow | null)[], tolerance: number): ConstraintSummary {
  const active = rows.filter((r): r is ResidualRow => !!r), core = active.filter(r => r.core);
  const measured = core.filter(r => r.after !== null);
  const stats = (values: number[]): Stats => values.length ? { max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length } : { max: null, mean: null };
  const before = core.flatMap(r => r.before === null ? [] : [r.before]), after = measured.map(r => r.after!);
  return {
    activeFrames: active.length, coreFrames: core.length, measuredCoreFrames: measured.length,
    unavailableFrames: active.filter(r => r.status === 'unavailable' || r.status === 'no-torso').length,
    unreachableFrames: active.filter(r => r.status === 'unreachable').length, cappedFrames: active.filter(r => r.status === 'capped').length,
    limitedFrames: active.filter(r => r.status === 'limited').length, blockedFrames: active.filter(r => r.status === 'blocked').length,
    before: stats(before), after: stats(after),
    satisfiedBefore: before.filter(x => x <= tolerance + 1e-9).length, satisfiedAfter: after.filter(x => x <= tolerance + 1e-9).length,
  };
}
