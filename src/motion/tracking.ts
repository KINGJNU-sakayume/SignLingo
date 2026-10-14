import type { Detection, Side } from './types';
import { confidence, valid } from './math';
import { Vector2 } from 'three';
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

export type HandAssociation = {
  assignment: Partial<Record<Side, number>>;
  identity: Record<Side, 'reliable' | 'ambiguous' | 'unavailable'>;
};

// A cut marker is produced during extraction. Legacy clips additionally get a
// conservative torso-discontinuity guard; landmarks cannot detect every edit.
export function sequenceBoundary(a: Detection, b: Detection): boolean {
  const dt = b.timestamp - a.timestamp;
  if (!Number.isFinite(a.timestamp) || !Number.isFinite(b.timestamp) || dt <= 0 || dt > 150 || b.discontinuity === 'cut') return true;
  return [11, 12].every(i => confidence(a.body[i]) >= .6 && confidence(b.body[i]) >= .6 &&
    Math.hypot(a.body[i].x - b.body[i].x, a.body[i].y - b.body[i].y) > .22);
}

type Track = { time: number; point: Vector2; velocity: Vector2 };
/** Small one-to-one assignment problem, with a bounded timestamp-aware predictor.
 * Reverse traversal supplies an independent identity check around occlusions.
 * Detector array order and preview mirroring are never identity cues.
 */
export class TemporalHandTracker {
  private tracks: Partial<Record<Side, Track>> = {};
  reset() { this.tracks = {}; }
  assign(frame: Detection): HandAssociation {
    const sides: Side[] = ['left', 'right'];
    const candidates = frame.hands.flatMap((h, i) => h.score >= .5 && h.image.length === 21 && h.world.length === 21 && h.image.every(valid) && h.world.every(valid) ? [i] : []);
    const costs = (side: Side, index: number) => {
      const hand = frame.hands[index], p = new Vector2(hand.image[0].x, hand.image[0].y);
      const wrist = frame.body[side === 'left' ? 15 : 16];
      const anchored = confidence(wrist) >= .45;
      const distance = anchored ? p.distanceTo(new Vector2(wrist.x, wrist.y)) : 0;
      // Contradictory anatomical evidence vetoes temporal prediction.
      if (anchored && distance > .23) return Infinity;
      const previous = this.tracks[side];
      const dt = previous ? (frame.timestamp - previous.time) / 1000 : 0;
      const continuing = previous && Math.abs(dt) > 0 && Math.abs(dt) <= .15;
      if (!anchored && !continuing) return Infinity;
      let temporal = 0;
      if (continuing) {
        const movement = p.distanceTo(previous.point);
        if (movement > .04 + 3.5 * Math.abs(dt)) return Infinity;
        const predicted = previous.point.clone().addScaledVector(previous.velocity, dt);
        const residual = p.distanceTo(predicted);
        // Acceleration allowance grows quadratically with elapsed time. A valid
        // sharp turn with a clear anatomical anchor remains an observation.
        if (!anchored && residual > .035 + 25 * dt * dt) return Infinity;
        temporal = Math.min(.2, residual) * .8;
      }
      return (anchored ? distance : .045) + temporal + (hand.label.toLowerCase() === side ? 0 : .012);
    };
    const alternatives: { cost: number; assignment: Partial<Record<Side, number>> }[] = [];
    for (const left of [-1, ...candidates]) for (const right of [-1, ...candidates]) {
      if (left >= 0 && left === right) continue;
      alternatives.push({ cost: (left < 0 ? .28 : costs('left', left)) + (right < 0 ? .28 : costs('right', right)),
        assignment: { ...(left >= 0 ? { left } : {}), ...(right >= 0 ? { right } : {}) } });
    }
    alternatives.sort((a, b) => a.cost - b.cost);
    const best = alternatives[0], assignment = { ...best.assignment };
    const identity: HandAssociation['identity'] = { left: 'unavailable', right: 'unavailable' };
    for (const side of sides) {
      const index = assignment[side];
      if (index === undefined) continue;
      if (alternatives.some(a => a.cost - best.cost < .025 && a.assignment[side] !== index)) {
        delete assignment[side]; identity[side] = 'ambiguous'; continue;
      }
      identity[side] = 'reliable';
      const point = new Vector2(frame.hands[index].image[0].x, frame.hands[index].image[0].y);
      const old = this.tracks[side], dt = old ? (frame.timestamp - old.time) / 1000 : 0;
      const velocity = old && Math.abs(dt) > 0 && Math.abs(dt) <= .15 ? point.clone().sub(old.point).divideScalar(dt) : new Vector2();
      velocity.clampLength(0, 3.5);
      this.tracks[side] = { time: frame.timestamp, point, velocity };
    }
    return { assignment, identity };
  }
}

export function reconcileAssociations(forward: HandAssociation, backward: HandAssociation): HandAssociation {
  const assignment: HandAssociation['assignment'] = {};
  const identity: HandAssociation['identity'] = { left: 'unavailable', right: 'unavailable' };
  for (const side of ['left', 'right'] as const) {
    const a = forward.assignment[side], b = backward.assignment[side];
    if (a !== undefined && a === b) { assignment[side] = a; identity[side] = 'reliable'; }
    else if (a !== undefined || b !== undefined || forward.identity[side] === 'ambiguous' || backward.identity[side] === 'ambiguous') identity[side] = 'ambiguous';
  }
  return { assignment, identity };
}
