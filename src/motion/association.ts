import type { Detection, Side } from './types';
import { confidence, valid } from './landmark';

// Single-frame wrist association. Kept free of three.js so the inference worker's 0.3.1 gap-fill can apply
// exactly the rule the solver applies to the stored detection. Re-exported by tracking.ts.
/** A hand farther than this (normalized image units) from a pose wrist cannot be that wrist's hand. */
export const WRIST_GATE = 0.23;
/** Hands below this handedness score are not association candidates. */
export const MIN_HAND_SCORE = 0.5;
// Handedness labels are only a weak tie-breaker: anatomical pose wrists anchor identity.
// Input pixels are unmirrored BEFORE either detector runs, so this rule is invariant.
export function assignHands(frame: Detection): { assignment: Partial<Record<Side, number>>; warnings: string[] } {
  const { assignment, warnings } = assignHandsDetailed(frame);
  return { assignment, warnings };
}
/** Pose wrist reliably inside the image (2% margin): hands outside it are not judged as tracking failures. */
export function wristInImage(frame: Pick<Detection, 'body'>, side: Side): boolean {
  const p = frame.body[side === 'left' ? 15 : 16];
  return confidence(p) >= .45 && p.x > .02 && p.x < .98 && p.y > .02 && p.y < .98;
}
export type HandFate = { side: Side } | { discarded: 'invalid-landmarks' | 'low-score' | 'no-reliable-wrist' | 'wrist-too-far' | 'ambiguous-crossing' | 'outcompeted' };
/**
 * The wrist association plus, for diagnostics, the best assignment before ambiguous sides were withheld and
 * each hand's fate (its side, or why it was discarded). `assignHands` returns exactly its assignment and warnings.
 */
export function assignHandsDetailed(frame: Detection): { assignment: Partial<Record<Side, number>>; warnings: string[]; best: Partial<Record<Side, number>>; fates: HandFate[] } {
  const sides: Side[] = ['left', 'right'];
  const warnings: string[] = [];
  const candidates = frame.hands.map((h, i) => ({ h, i })).filter(({ h }) => h.world.length === 21 && h.world.every(valid) && h.image.length === 21 && h.image.every(valid) && h.score >= MIN_HAND_SCORE);
  const cost = (side: Side, index: number) => {
    const wrist = frame.body[side === 'left' ? 15 : 16];
    if (confidence(wrist) < 0.45) return Infinity;
    const hand = frame.hands[index];
    const d = Math.hypot(wrist.x-hand.image[0].x, wrist.y-hand.image[0].y);
    return d > WRIST_GATE ? Infinity : d + (hand.label.toLowerCase() === side ? 0 : 0.015);
  };
  let best = Infinity;
  const alternatives: { cost: number; assignment: Partial<Record<Side, number>> }[] = [];
  let assignment: Partial<Record<Side, number>> = {};
  for (const l of [-1, ...candidates.map(x => x.i)]) for (const r of [-1, ...candidates.map(x => x.i)]) {
    if (l >= 0 && l === r) continue;
    const c = (l < 0 ? 0.25 : cost('left', l)) + (r < 0 ? 0.25 : cost('right', r));
    const option = { ...(l >= 0 ? { left: l } : {}), ...(r >= 0 ? { right: r } : {}) };
    alternatives.push({cost:c,assignment:option});
    if (c < best) { best = c; assignment = option; }
  }
  const preferred = { ...assignment };
  const ambiguous = sides.filter(side => assignment[side] !== undefined && alternatives.some(a => a.cost-best < .025 && a.assignment[side] !== assignment[side]));
  if (ambiguous.length) {
    warnings.push('Ambiguous hand identity near crossing wrists; uncertain hands withheld.');
    assignment = { ...assignment };
    for (const side of ambiguous) delete assignment[side];
  }
  for (const side of sides) if (assignment[side] === undefined) warnings.push(`${side}: no reliable wrist-associated hand.`);
  const fates = frame.hands.map((h, i): HandFate => {
    const side = sides.find(s => assignment[s] === i);
    if (side) return { side };
    if (h.world.length !== 21 || !h.world.every(valid) || h.image.length !== 21 || !h.image.every(valid)) return { discarded: 'invalid-landmarks' };
    if (h.score < MIN_HAND_SCORE) return { discarded: 'low-score' };
    if (sides.every(s => confidence(frame.body[s === 'left' ? 15 : 16]) < .45)) return { discarded: 'no-reliable-wrist' };
    if (sides.every(s => cost(s, i) === Infinity)) return { discarded: 'wrist-too-far' };
    return { discarded: sides.some(s => preferred[s] === i) ? 'ambiguous-crossing' : 'outcompeted' };
  });
  return { assignment, warnings, best: preferred, fates };
}

