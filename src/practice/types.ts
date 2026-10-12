import type { MotionClip, Side } from '../motion/types';
export type Interval = { start: number; end: number; method: 'activity' | 'manual' | 'full'; note?: string };
export type Component = 'handshape' | 'palm' | 'position' | 'face' | 'trajectory' | 'direction' | 'coordination';
export type Metric = { component: Component; side?: Side; value: number | null; coverage: number; samples: number; unit: 'degrees' | 'body' };
export type AlignmentPair = { reference: number; learner: number; referenceTime: number; learnerTime: number };
export type Feedback = { kind: 'observed' | 'tracking'; key: 'low' | 'palm' | 'index' | 'path' | 'missing'; side: Side; pair: number; value?: number };
export type Comparison = {
  referenceInterval: Interval; learnerInterval: Interval; pairs: AlignmentPair[];
  metrics: Metric[]; feedback: Feedback[]; durationRatio: number; maxWarp: number;
  evidence: 'sufficient' | 'limited';
};
// Practice state is separate from the versioned reconstruction interchange format.
// This lives only in memory; neither recordings nor sessions are uploaded or persisted.
export type PracticeSession = {
  schema: 'signlingo.practice'; version: 1; attempt: number;
  reference: MotionClip; learner: MotionClip; comparison: Comparison;
  linguisticValidation: 'not-performed';
};
