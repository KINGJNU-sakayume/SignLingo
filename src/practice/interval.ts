import { participation, signingInterval } from '../motion/signing';
import { frameFeature } from './features';
import { SIDES, type MotionClip } from '../motion/types';
import type { Interval } from './types';

/** Trimming keeps at least this share of the signing interval; otherwise the untrimmed interval is used. */
const MIN_KEPT = .5;

/**
 * Default comparison interval for both clips: the signing interval the constraint solver and the learner display use
 * (hands raised from rest), so the rest before and after a sign never enters the alignment. Falls back to the motion
 * heuristic (`activeInterval`) when no hand is ever raised. Either way it stays adjustable by hand.
 *
 * The interval then starts and ends on frames where every hand taking part in the sign has a measured position (the
 * Practice features' own reliability rules): a hand entering from below a tightly framed shot has no start position,
 * and the trajectory metric never invents one.
 */
export function practiceInterval(clip: MotionClip): Interval {
  const s = signingInterval(clip), taking = participation(clip), sides = SIDES.filter(side => taking[side].participates);
  const located = (hand: ReturnType<typeof frameFeature>['hands'][typeof SIDES[number]]) => !!(hand?.position || hand?.position2D);
  const tracked = clip.frames.filter(f => f.timestamp / 1000 >= s.start - 1e-6 && f.timestamp / 1000 <= s.end + 1e-6
    && sides.every(side => located(frameFeature(f, 0).hands[side])));
  let start = s.start, end = s.end;
  if (sides.length && tracked.length) {
    const a = tracked[0].timestamp / 1000, b = tracked.at(-1)!.timestamp / 1000;
    if (b - a >= MIN_KEPT * (s.end - s.start)) { start = a; end = b; }
  }
  return { start, end, method: s.method as Interval['method'], ...(s.note ? { note: s.note } : {}) };
}
