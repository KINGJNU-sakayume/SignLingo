import type { Detection, Side } from './types';
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
  const ambiguous = sides.filter(side => assignment[side] !== undefined && alternatives.some(a => a.cost-best < .025 && a.assignment[side] !== assignment[side]));
  if (ambiguous.length) {
    warnings.push('Ambiguous hand identity near crossing wrists; uncertain hands withheld.');
    assignment = { ...assignment };
    for (const side of ambiguous) delete assignment[side];
  }
  for (const side of sides) if (assignment[side] === undefined) warnings.push(`${side}: no reliable wrist-associated hand.`);
  return { assignment, warnings };
}
