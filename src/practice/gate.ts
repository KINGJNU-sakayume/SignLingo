import type { MotionClip } from '../motion/types';
import { compareMotion } from './compare';

/**
 * Publish gate for a lesson reference: compared with itself, every component of the hands the sign uses must be
 * measurable (direction may lack moving samples) and no difference may be reported. A reference that fails would
 * hide metrics from, or give feedback to, a learner who copies it exactly.
 */
export function practiceReadiness(clip: MotionClip): string[] {
  const self = compareMotion(clip, clip);
  return [
    ...self.metrics.filter(m => m.value === null && m.component !== 'direction').map(m => `${m.side ?? 'both'} ${m.component} is not measurable`),
    ...self.feedback.map(f => `self-comparison reports ${f.key} (${f.side})`),
  ];
}
