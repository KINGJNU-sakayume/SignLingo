import type { MotionClip, Side } from '../motion/types';
import type { RubricItem } from './rubric';
export type Interval = { start: number; end: number; method: 'raised-hands' | 'activity' | 'manual' | 'full'; note?: string };
export type Component = 'handshape' | 'palm' | 'position' | 'face' | 'trajectory' | 'direction' | 'coordination';
export type Metric = { component: Component; side?: Side; value: number | null; coverage: number; samples: number; unit: 'degrees' | 'body'; space?:'hand'|'estimated3d'|'image2d'; reason?:string; image?:{value:number|null;coverage:number;samples:number} };
export type AlignmentPair = { reference: number; learner: number; referenceTime: number; learnerTime: number };
/**
 * `unused`: the learner raised a hand the reference keeps down. `mirror`: the attempt looks left-right mirrored (opposite hand).
 * `shape` / `facing`: a reviewed handshape / palm-facing constraint of the reference is not met (`note` is the constraint's note).
 */
export type Feedback = { kind: 'observed' | 'tracking'; key: 'low' | 'palm' | 'index' | 'path' | 'missing' | 'unused' | 'mirror' | 'shape' | 'facing'; side: Side; pair: number; value?: number; note?: string };
export type Comparison = {
  referenceInterval: Interval; learnerInterval: Interval; pairs: AlignmentPair[];
  /** Hands compared: those taking part in the reference sign. */
  sides: Side[];
  /** Mean DTW cost per step; with `mirror`, the same for the left-right mirrored learner. */
  alignmentCost: number; mirror?: { cost: number; mirroredCost: number; detected: boolean };
  metrics: Metric[]; feedback: Feedback[]; durationRatio: number; maxWarp: number;
  /** The reference's reviewed handshape/palm constraints checked on the learner's tracked frames (empty without constraints). */
  rubric: RubricItem[];
  evidence: 'sufficient' | 'limited';
};
// Practice state is separate from the versioned reconstruction interchange format.
// This lives only in memory; neither recordings nor sessions are uploaded or persisted.
export type PracticeSession = {
  schema: 'signlingo.practice'; version: 1; attempt: number;
  reference: MotionClip; learner: MotionClip; comparison: Comparison;
  linguisticValidation: 'not-performed';
};
