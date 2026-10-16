// Learner-screen jitter smoothing (display only): steadier holds, taps and contacts kept, stored motion untouched.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importMotion } from '../src/motion/serialization';
import { displayFor, learnerStages, runDisplayPipeline, SMOOTH_STAGE, type SmoothReport } from '../src/motion/display';
import { handState, pointPosition } from '../src/motion/constraints/points';
import { forwardArm } from '../src/motion/rig';
import { SIDES, type DisplayPose, type MotionClip } from '../src/motion/types';

const load = (id: string, revision: number): MotionClip => importMotion(readFileSync(`public/content/assets/${id}/v${revision}/reference.motion.json`, 'utf8'));
const unsmoothed = (clip: MotionClip) => runDisplayPipeline({ clip }, learnerStages().filter(stage => stage.id !== SMOOTH_STAGE));
const distance = (pose: DisplayPose, a: string, b: string) => {
  const hands = { left: handState(pose, 'left'), right: handState(pose, 'right') };
  return pointPosition(pose, hands, a as never).distanceTo(pointPosition(pose, hands, b as never));
};
/** RMS frame-to-frame wrist motion over frames [a, b]: in a hold, all of it is jitter. */
const step = (poses: DisplayPose[], a: number, b: number) => {
  let sum = 0, n = 0;
  for (let i = a + 1; i <= b; i++) for (const side of SIDES) { sum += forwardArm(poses[i - 1], side).wrist.distanceToSquared(forwardArm(poses[i], side).wrist); n++; }
  return Math.sqrt(sum / n);
};

describe('jitter smoothing on learner screens', () => {
  it('steadies a held pose and moves no wrist far', () => {
    // ksl-meet revision 3 holds the two hands together from frame 72.
    for (const [id, revision, a, b] of [['ksl-meet', 3, 72, 92]] as const) {
      const clip = load(id, revision), before = unsmoothed(clip).frames.map(f => f.pose), after = displayFor(clip, 'learner').frames.map(f => f.pose);
      expect(step(after, a, b), id).toBeLessThan(step(before, a, b) * .8);
    }
    for (const [id, revision] of [['ksl-thanks', 4], ['ksl-sorry', 3], ['ksl-meet', 3]] as const) {
      const report = displayFor(load(id, revision), 'learner').reports[SMOOTH_STAGE] as SmoothReport;
      for (const side of SIDES) expect(report.maxWristShift[side], `${id} ${side}`).toBeLessThan(.04);
    }
  });
  it('keeps the two taps of ksl-thanks distinct', () => {
    const clip = load('ksl-thanks', 4), frames = displayFor(clip, 'learner').frames;
    const edge = frames.map(f => distance(f.pose, 'right.pinkyEdge', 'left.back'));
    // Revision 4: touches at frames 62–64 and 68–70 (1.5 cm), the hand lifts to 9.5 cm at frame 66.
    expect(Math.min(...edge.slice(61, 65))).toBeLessThan(.03);
    expect(Math.min(...edge.slice(67, 71))).toBeLessThan(.03);
    expect(edge[66]).toBeGreaterThan(.06);
  });
  it('never changes the stored clip', () => {
    const clip = load('ksl-meet', 3), snapshot = JSON.stringify(clip);
    runDisplayPipeline({ clip }, learnerStages());
    expect(JSON.stringify(clip)).toBe(snapshot);
  });
});
