// Solver v3 (course-1 v4 candidates): the observed arm angle is kept when a contact moves a hand, a contact may act in
// the front camera's image plane, and a repeated contact acts only at its approaches. Published clips are read only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { importMotion } from '../src/motion/serialization';
import { applyConstraints, parseConstraints } from '../src/motion/constraints';
import { projectedElbow } from '../src/motion/constraints/solve';
import { handState, pointPosition } from '../src/motion/constraints/points';
import { editedPose } from '../src/motion/player';
import { forwardArm } from '../src/motion/rig';
import type { MotionClip } from '../src/motion/types';

const load = (id: string, revision: number): MotionClip => importMotion(readFileSync(`public/content/assets/${id}/v${revision}/reference.motion.json`, 'utf8'));
const doc = (id: string) => parseConstraints(readFileSync(`docs/constraints/${id}.constraints.json`, 'utf8'));
const points = (clip: MotionClip, i: number, a: string, b: string) => {
  const pose = editedPose(clip, i), hands = { left: handState(pose, 'left'), right: handState(pose, 'right') };
  return [pointPosition(pose, hands, a as never), pointPosition(pose, hands, b as never)];
};
const image = (p: Vector3, q: Vector3) => Math.hypot(p.x - q.x, p.y - q.y);

describe('projected elbow', () => {
  it('keeps an observed elbow that the arm can still reach', () => {
    const pose = editedPose(load('ksl-sorry', 1), 48), arm = forwardArm(pose, 'right');
    expect(projectedElbow(arm.shoulder, arm.wrist, arm.elbow, 720).distanceTo(arm.elbow)).toBeLessThan(.005);
  });
});

describe('ksl-sorry: forehead contact in the image plane', () => {
  it('puts the circle on the forehead as seen from the front and keeps the observed arm angle and depth', async () => {
    const source = load('ksl-sorry', 1), { clip, solution } = await applyConstraints(source, doc('ksl-sorry'));
    const forehead = solution.constraints.find(c => c.id === 'sorry-forehead')!;
    expect(forehead.summary.satisfiedAfter).toBe(forehead.summary.measuredCoreFrames);
    const core = forehead.rows.flatMap((row, i) => row?.core ? [i] : []);
    expect(core.length).toBeGreaterThan(5);
    for (const i of core) expect(image(...points(clip, i, 'right.index.tip', 'head.forehead') as [Vector3, Vector3])).toBeLessThan(.03);
    let elbow = 0, depth = 0;
    for (let i = 30; i <= 80; i++) {
      const a = forwardArm(editedPose(source, i), 'right'), b = forwardArm(editedPose(clip, i), 'right');
      elbow = Math.max(elbow, image(a.elbow, b.elbow)); depth = Math.max(depth, Math.abs(a.wrist.z - b.wrist.z));
    }
    // Revision 2 (whose arm angle the reviewer preferred) deviates up to 6.6 cm; the 3D contact of the revision-3 candidate 19.8 cm.
    expect(elbow).toBeLessThan(.1);
    expect(depth).toBeLessThan(.005);
  });
});

describe('ksl-thanks: two taps', () => {
  it('touches the left hand at the two closest approaches and lifts in between as observed', async () => {
    const { clip, solution } = await applyConstraints(load('ksl-thanks', 1), doc('ksl-thanks'));
    const tap = solution.constraints.find(c => c.id === 'thanks-tap')!;
    expect(tap.approaches).toHaveLength(2);
    const distance = clip.frames.map((_, i) => { const [a, b] = points(clip, i, 'right.pinkyEdge', 'left.back'); return a.distanceTo(b); });
    const at = tap.approaches!.map(t => clip.frames.findIndex(f => Math.abs(f.timestamp - t) < 1e-6));
    for (const i of at) expect(distance[i]).toBeLessThan(.02);
    expect(Math.max(...distance.slice(at[0] + 1, at[1]))).toBeGreaterThan(.06);
    // Revision 3 never brought the hands closer than about 12 cm.
    const v3 = load('ksl-thanks', 3);
    expect(Math.min(...v3.frames.map((_, i) => { const [a, b] = points(v3, i, 'right.pinkyEdge', 'left.back'); return a.distanceTo(b); }))).toBeGreaterThan(.1);
  });
});
