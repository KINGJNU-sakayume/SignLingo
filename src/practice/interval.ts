import { signingInterval } from '../motion/signing';
import type { MotionClip } from '../motion/types';
import type { Interval } from './types';

/**
 * Default comparison interval for both clips: the signing interval the constraint solver and the learner display use
 * (hands raised from rest), so the rest before and after a sign never enters the alignment. Falls back to the motion
 * heuristic (`activeInterval`) when no hand is ever raised. Either way it stays adjustable by hand.
 */
export function practiceInterval(clip: MotionClip): Interval {
  const s = signingInterval(clip);
  return { start: s.start, end: s.end, method: s.method as Interval['method'], ...(s.note ? { note: s.note } : {}) };
}
