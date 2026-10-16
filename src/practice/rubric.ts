import { editedPose } from '../motion/player';
import { armVisible } from '../motion/display/pipeline';
import { signingInterval } from '../motion/signing';
import { sourceClip, storedHand } from '../motion/constraints/bake';
import { orientationResidual } from '../motion/constraints/solve';
import { blendWeight, resolveSpan, type SigningInterval } from '../motion/constraints/spans';
import type { Constraint } from '../motion/constraints/schema';
import { SIDES, type MotionClip, type Side } from '../motion/types';
import { activeInterval } from './features';
import type { AlignmentPair } from './types';

/**
 * One reviewed handshape or palm-facing constraint applied to the learner: residuals on the learner's TRACKED frames
 * that the alignment pairs with the constraint's core frames in the reference. Position constraints are left out:
 * they inherit the fixed rig's arm lengths and monocular depth error (report 2026-10-16, 3-5).
 */
export type RubricItem = {
  id: string; kind: 'handshape' | 'palmFacing'; side: Side; note: string;
  /** Residual a frame may have and still match: the reference signer's own observed spread plus a margin. */
  limit: number;
  /** Median residual of the reference's observed (pre-correction) frames and of the learner's frames. */
  reference: number; learner: number | null;
  /** Learner frames measured and the share within `limit`. */
  frames: number; satisfied: number;
  /** null: fewer than MIN_FRAMES tracked learner frames, no claim. */
  passes: boolean | null;
  /** First alignment pair of the measured frames, for jumping to the moment. */
  pair: number;
};

export const RUBRIC_MIN_FRAMES = 3;
/** A learner matches when this share of measured frames is within the limit. */
export const RUBRIC_PASS = .6;
/**
 * Native signers differ from the idealized presets (observed handshape residuals reach 30–80°), so the limit is
 * relative: the 90th percentile of the reference's own observed residuals plus a margin, never below the solver tolerance.
 */
const MARGIN = { handshape: 10, palmFacing: 15 } as const;
const TOLERANCE = { handshape: 2, palmFacing: (c: Constraint) => ((c as { toleranceDeg?: number }).toleranceDeg ?? 0) + .5 } as const;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const quantile = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const tracked = (clip: MotionClip, i: number, side: Side) => storedHand(clip.frames[i], side) === 'observed';

/** The interval the reference's constraints were baked against (solver v1 used Practice's motion heuristic). */
function bakedInterval(clip: MotionClip): SigningInterval {
  if (clip.constraints?.solver === 'signlingo-constraint-solver-v1') { const a = activeInterval(clip); return { start: a.start, end: a.end, method: a.method }; }
  const s = signingInterval(clip); return { start: s.start, end: s.end, method: s.method };
}

function residualAt(c: Constraint, clip: MotionClip, i: number, side: Side) {
  if (!tracked(clip, i, side)) return null;
  const pose = editedPose(clip, i);
  const shown = { left: armVisible(pose, 'left'), right: armVisible(pose, 'right') };
  const source = { left: storedHand(clip.frames[i], 'left'), right: storedHand(clip.frames[i], 'right') };
  return orientationResidual(c, pose, shown, source);
}

/**
 * Rubric items for the reference's constraint document (none for an uncorrected reference). Per-hand: a `both`
 * constraint becomes one item per compared hand.
 */
export function constraintRubric(reference: MotionClip, learner: MotionClip, pairs: readonly AlignmentPair[], sides: readonly Side[] = SIDES): RubricItem[] {
  const document = reference.constraints?.document;
  if (!document) return [];
  const source = sourceClip(reference), interval = bakedInterval(reference), timestamps = source.frames.map(f => f.timestamp);
  const items: RubricItem[] = [];
  for (const constraint of document.constraints) {
    if (constraint.kind !== 'handshape' && constraint.kind !== 'palmFacing') continue;
    const span = resolveSpan(constraint.span, timestamps, interval);
    if (!span) continue;
    const core = (i: number) => blendWeight(timestamps[i], span, constraint.blendMs) >= 1;
    for (const side of (constraint.hand === 'both' ? SIDES : [constraint.hand]).filter(s => sides.includes(s))) {
      const c = { ...constraint, hand: side } as Constraint;
      const own: number[] = [];
      for (let i = span.firstFrame; i <= span.lastFrame; i++) if (core(i)) { const r = residualAt(c, source, i, side); if (r !== null) own.push(r); }
      if (own.length < RUBRIC_MIN_FRAMES) continue;
      const kind = constraint.kind, limit = Math.max(kind === 'handshape' ? TOLERANCE.handshape : TOLERANCE.palmFacing(constraint), quantile(own, .9) + MARGIN[kind]);
      const seen = new Set<number>(), values: number[] = [];
      let first = -1;
      pairs.forEach((p, k) => {
        if (!core(p.reference) || seen.has(p.learner)) return;
        seen.add(p.learner);
        const r = residualAt(c, learner, p.learner, side);
        if (r === null) return;
        values.push(r); if (first < 0) first = k;
      });
      const satisfied = values.filter(r => r <= limit + 1e-9).length / (values.length || 1);
      items.push({ id: constraint.id, kind, side, note: constraint.note, limit, reference: median(own),
        learner: values.length ? median(values) : null, frames: values.length, satisfied,
        passes: values.length >= RUBRIC_MIN_FRAMES ? satisfied >= RUBRIC_PASS : null, pair: Math.max(0, first) });
    }
  }
  return items;
}
