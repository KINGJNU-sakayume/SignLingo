// Frozen Phase 1 (0.1.0) baseline for same-detection comparisons.
import type { Detection, Side } from '../types';
import { confidence, valid } from './math';
// Handedness labels are only a weak tie-breaker: anatomical pose wrists anchor identity.
// Input pixels are unmirrored BEFORE either detector runs, so this rule is invariant.
export function assignHands(frame: Detection): { assignment: Partial<Record<Side, number>>; warnings: string[] } {
  const sides: Side[] = ['left', 'right'];
  const warnings: string[] = [];
  const candidates = frame.hands.map((h, i) => ({ h, i })).filter(({ h }) => h.world.length === 21 && h.world.every(valid) && h.image.length === 21 && h.image.every(valid) && h.score >= 0.5);
  const cost = (side: Side, index: number) => {
    const wrist = frame.body[side === 'left' ? 15 : 16];
    if (confidence(wrist) < 0.45) return Infinity;
    const hand = frame.hands[index];
    const d = Math.hypot(wrist.x-hand.image[0].x, wrist.y-hand.image[0].y);
    return d > 0.23 ? Infinity : d + (hand.label.toLowerCase() === side ? 0 : 0.015);
  };
  let best = Infinity, second = Infinity;
  let assignment: Partial<Record<Side, number>> = {};
  for (const l of [-1, ...candidates.map(x => x.i)]) for (const r of [-1, ...candidates.map(x => x.i)]) {
    if (l >= 0 && l === r) continue;
    const c = (l < 0 ? 0.25 : cost('left', l)) + (r < 0 ? 0.25 : cost('right', r));
    if (c < best) { second = best; best = c; assignment = { ...(l >= 0 ? { left: l } : {}), ...(r >= 0 ? { right: r } : {}) }; }
    else if (c < second) second = c;
  }
  if (candidates.length > 1 && second-best < 0.025 && assignment.left !== undefined && assignment.right !== undefined) {
    warnings.push('Ambiguous hand identity near crossing wrists; hands withheld.');
    assignment = {};
  }
  for (const side of sides) if (assignment[side] === undefined) warnings.push(`${side}: no reliable wrist-associated hand.`);
  return { assignment, warnings };
}
