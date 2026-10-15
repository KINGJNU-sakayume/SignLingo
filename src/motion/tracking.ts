import type { Detection, Side } from './types';
import { confidence, valid } from './math';
import { Vector2 } from 'three';
export { assignHands, assignHandsDetailed, wristInImage, MIN_HAND_SCORE, WRIST_GATE, type HandFate } from './association';

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
        const directAnchor = confidence(wrist) >= .8 && hand.score >= .8 && distance < .06;
        if (movement > .04 + 3.5 * Math.abs(dt) && !directAnchor) return Infinity;
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
