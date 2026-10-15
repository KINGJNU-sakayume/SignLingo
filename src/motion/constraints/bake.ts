import { canonicalSha256 } from '../canonical';
import { editedPose } from '../player';
import type { MotionClip, MotionFrame, Quat, Side } from '../types';
import { CONSTRAINT_FORMAT, type ConstraintSet } from './schema';
import { solveConstraints, type ConstraintSolution, type HandSource } from './solve';

/**
 * v2: phase/fraction spans follow `signingInterval` (hands raised from rest) instead of Practice's motion heuristic,
 * and the two hands never pass into each other. Clips baked by v1 keep their record.
 */
export const CONSTRAINT_SOLVER = 'signlingo-constraint-solver-v2';
export const storedHand = (frame: MotionFrame, side: Side): HandSource => {
  const state = frame.pose.quality[`${side}State`];
  return state === 'tracked' ? 'observed' : state;
};
export const constraintHash = (set: ConstraintSet) => canonicalSha256(set);

/** The source clip of a version-2 clip: stored rotations and wrist edits exactly as before correction. */
export function sourceClip(clip: MotionClip): MotionClip {
  if (clip.version !== 2 || !clip.constraints) return clip;
  const { constraints, ...rest } = clip;
  return { ...rest, version: 1, edits: constraints.sourceEdits.map(edit => ({ ...edit, degrees: [...edit.degrees] as typeof edit.degrees })),
    frames: clip.frames.map(({ constraint, ...frame }) => constraint
      ? { ...frame, pose: { ...frame.pose, rotations: { ...frame.pose.rotations, ...constraint.original } } } : frame) };
}

/**
 * Constraints applied to the STORED frames (wrist edits applied, no display stage): exactly what a re-export of the
 * corrected clip will play. A version-2 clip is solved again from its source, so constraints never stack.
 */
export function solveStored(clip: MotionClip, set: ConstraintSet): ConstraintSolution {
  const source = sourceClip(clip);
  return solveConstraints({ clip: source, poses: source.frames.map((_, i) => editedPose(source, i)), timestamps: source.frames.map(f => f.timestamp),
    hands: (i, side) => storedHand(source.frames[i], side), set });
}

const pick = (rotations: Record<string, Quat>, keys: string[]) => Object.fromEntries(keys.map(key => [key, rotations[key]]));
// A rotation the solver did not change can still differ in the last bits after a JSON round trip; such joints are
// not changes (the same 1e-12 tolerance the solver uses).
const same = (a: Quat, b: Quat) => a.every((x, k) => Math.abs(x - b[k]) < 1e-12);

/**
 * A corrected MotionClip (version 2). Landmarks, quality, warnings, corrections and the pipeline record are the
 * source's; changed frames keep their original rotations and the per-hand evidence, and the full constraint
 * document is recorded with its canonical SHA-256. Display post-processing never enters the file.
 */
export async function applyConstraints(clip: MotionClip, set: ConstraintSet): Promise<{ clip: MotionClip; source: MotionClip; solution: ConstraintSolution }> {
  if (clip.version === 2 && clip.edits.length) {
    throw new Error('보정본에 나중에 더한 손목 보정이 있어 원본에서 다시 계산할 수 없습니다. 그 보정을 wristOffset 제약으로 옮기거나 보정 전 동작에 적용하세요.');
  }
  const source = sourceClip(clip), solution = solveStored(source, set);
  const changes = new Map(solution.changes.map(change => [change.index, change]));
  const frames = source.frames.map((frame, i): MotionFrame => {
    const raw = frame.pose.rotations, out = solution.poses[i].rotations;
    const joints = Object.keys(raw).filter(key => !same(raw[key], out[key]));
    if (!joints.length) return frame;
    const change = changes.get(i);
    return { ...frame, pose: { ...frame.pose, rotations: { ...raw, ...pick(out, joints) } },
      constraint: { applied: change?.applied ?? [], joints, original: pick(raw, joints), evidence: change?.evidence ?? {} } };
  });
  const corrected: MotionClip = { ...source, version: 2, frames, edits: [], constraints: {
    format: CONSTRAINT_FORMAT, document: set, sha256: await constraintHash(set), solver: CONSTRAINT_SOLVER, sourceEdits: source.edits,
    summary: { changedFrames: frames.filter(f => f.constraint).length, constraints: solution.constraints.map(c => ({
      id: c.id, kind: c.kind, unit: c.unit, activeFrames: c.summary.activeFrames, coreFrames: c.summary.coreFrames,
      beforeMax: c.summary.before.max, afterMax: c.summary.after.max })) },
  } };
  return { clip: corrected, source, solution };
}

/** Rejects a version-2 clip whose recorded hash does not match its recorded constraint document. */
export async function verifyConstraintRecord(clip: MotionClip) {
  if (!clip.constraints) return;
  if (await constraintHash(clip.constraints.document) !== clip.constraints.sha256) throw new Error('동작 파일에 기록된 제약 조건과 해시가 다릅니다.');
}
