import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { detection, fixtureClip, lm } from './fixtures';
import { Reconstructor } from '../src/motion/reconstruct';
import { TemporalHandTracker, reconcileAssociations } from '../src/motion/tracking';
import { reconstructTemporal, reconstructTemporalAsync, validInferredFingers } from '../src/motion/temporalReconstruction';
import { forwardHand } from '../src/motion/rig';
import { q } from '../src/motion/math';
import { editedPose, samplePose } from '../src/motion/player';
import { exportMotion, importMotion } from '../src/motion/serialization';
import { features, activeInterval } from '../src/practice/features';
import { compareMotion } from '../src/practice/compare';
import { appearanceCut } from '../src/motion/sceneCut';
import type { Detection, MotionClip } from '../src/motion/types';

function sequence(times = [0, 33, 66, 100, 133, 166, 200]): MotionClip {
  const clip = fixtureClip(), solver = new Reconstructor();
  clip.pipeline.version = '0.2.0';
  clip.frames = times.map(timestamp => solver.reconstruct(articulatedDetection({ timestamp, flex: [.2 + timestamp / 2000, .3, .2], spread: .1,
    palm: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), timestamp / 1000)) })));
  return clip;
}
function hide(clip: MotionClip, indices: number[], body = false): MotionClip {
  const solver = new Reconstructor();
  return { ...clip, frames: clip.frames.map((source, i) => {
    const d: Detection = structuredClone(source);
    if (indices.includes(i)) {
      d.hands = [];
      if (body) for (const wrist of [15, 16]) { d.body[wrist].visibility = 0; d.bodyWorld[wrist].visibility = 0; }
    }
    return solver.reconstruct(d);
  }) };
}

describe('sequence hand identity', () => {
  it('retains identity through reordered detections and a missing pose wrist', () => {
    const tracker = new TemporalHandTracker();
    expect(tracker.assign(detection()).assignment).toEqual({ left: 0, right: 1 });
    const next = detection(33); next.hands.reverse(); next.body[15].visibility = 0;
    expect(tracker.assign(next)).toMatchObject({ assignment: { left: 1, right: 0 }, identity: { left: 'reliable' } });
  });
  it('uses motion through crossing wrists without following detector order', () => {
    const tracker = new TemporalHandTracker();
    for (let i = 0; i < 6; i++) {
      const f = detection(i * 33), x = .7 - i * .08;
      f.body[15] = lm(x, .6); f.body[16] = lm(1 - x, .6);
      f.hands[0].image[0] = f.body[15]; f.hands[1].image[0] = f.body[16];
      if (i >= 3) f.hands.reverse();
      expect(tracker.assign(f).assignment).toEqual(i >= 3 ? { left: 1, right: 0 } : { left: 0, right: 1 });
    }
  });
  it('withholds ambiguous crossings and never duplicates a detection', () => {
    const f = detection(); f.hands = f.hands.slice(0, 1); f.body[15] = f.body[16] = f.hands[0].image[0] = lm(.5, .6);
    const result = new TemporalHandTracker().assign(f);
    expect(result.assignment).toEqual({}); expect(Object.values(result.identity)).toContain('ambiguous');
  });
  it('does not allow stale prediction to override contradictory anatomy', () => {
    const tracker = new TemporalHandTracker(); tracker.assign(detection());
    const next = detection(33); next.body[15] = lm(.05, .1); next.hands = next.hands.slice(0, 1);
    expect(tracker.assign(next).assignment.left).toBeUndefined();
    const missing = detection(250); missing.body = [];
    expect(tracker.assign(missing).assignment).toEqual({});
  });
  it('requires forward/backward agreement and expires ambiguous acceleration', () => {
    const a = { assignment: { left: 0, right: 1 }, identity: { left: 'reliable', right: 'reliable' } } as const;
    const b = { ...a, assignment: { left: 1, right: 0 } };
    expect(reconcileAssociations(a, b)).toEqual({ assignment: {}, identity: { left: 'ambiguous', right: 'ambiguous' } });
    const tracker = new TemporalHandTracker(); tracker.assign(detection());
    const f = detection(33); f.body[15].visibility = 0; f.hands[0].image[0].x += .1;
    expect(tracker.assign(f).assignment.left).toBeUndefined();
  });
});

describe('evidence-aware temporal reconstruction', () => {
  it('uses actual VFR timestamps, preserves anchors and original evidence', () => {
    const clip = hide(sequence([0, 20, 80, 120, 160]), [1, 2]);
    const snapshot = exportMotion(clip), result = reconstructTemporal(clip);
    expect(result.frames[1].pose.evidence?.left).toMatchObject({ state: 'interpolated', position: 'observed', fingers: 'interpolated', anchors: [0, 3] });
    const expected = forwardHand(clip.frames[0].pose, 'left').palm.slerp(forwardHand(clip.frames[3].pose, 'left').palm, 20 / 120);
    expect(forwardHand(result.frames[1].pose, 'left').palm.angleTo(expected)).toBeLessThan(1e-7);
    expect(result.frames[3].pose.rotations).toEqual(clip.frames[3].pose.rotations);
    expect(result.frames[1].pose.quality).toEqual(clip.frames[1].pose.quality);
    expect(exportMotion(clip)).toBe(snapshot);
  });
  it('solves missing wrist position with fixed bones and bounded fingers', () => {
    const result = reconstructTemporal(hide(sequence(), [2], true));
    expect(result.frames[2].pose.evidence?.left.position).toBe('interpolated');
    const hand = forwardHand(result.frames[2].pose, 'left');
    expect(hand.shoulder.distanceTo(hand.elbow)).toBeCloseTo(.28, 8);
    expect(hand.elbow.distanceTo(hand.wrist)).toBeCloseTo(.26, 8);
    expect(validInferredFingers(result.frames[2].pose, 'left')).toBe(true);
  });
  it('handles quaternion antipodes without a full spin', () => {
    const clip = hide(sequence(), [2]);
    for (const key of Object.keys(clip.frames[3].pose.rotations)) clip.frames[3].pose.rotations[key] = clip.frames[3].pose.rotations[key].map(x => -x) as [number, number, number, number];
    const result = reconstructTemporal(clip);
    expect(forwardHand(result.frames[2].pose, 'left').palm.angleTo(forwardHand(clip.frames[1].pose, 'left').palm)).toBeLessThan(.1);
    for (const quat of Object.values(result.frames[2].pose.rotations)) expect(q(quat).length()).toBeCloseTo(1, 8);
  });
  it('preserves sharp observed turns and manual edits without temporal lag', () => {
    const clip = sequence();
    clip.frames[3].pose.rotations['left.wrist'] = [1, 0, 0, 0];
    const result = reconstructTemporal(clip);
    expect(result.frames[3].pose.rotations).toEqual(clip.frames[3].pose.rotations);
    clip.edits = [{ frame: 3, side: 'left', degrees: [10, 0, 0] }];
    expect(editedPose(clip, 3, result).rotations['left.wrist']).toEqual(editedPose(clip, 3).rotations['left.wrist']);
    expect(samplePose(clip, .1, result).rotations['left.wrist']).toEqual(editedPose(clip, 3, result).rotations['left.wrist']);
  });
  it.each([['long', [0, 33, 66, 100, 133, 166, 200]], ['invalid', [0, 33, 20, 100, 133, 166, 200]]])('rejects %s intervals', (_, times) => {
    const result = reconstructTemporal(hide(sequence(times as number[]), [1, 2, 3, 4, 5]));
    expect(result.frames.slice(1, 6).every(f => f.pose.evidence?.left.state !== 'interpolated')).toBe(true);
  });
  it('does not bridge cuts, missing shoulders, or an out-of-frame wrist', () => {
    for (const condition of ['cut', 'shoulders', 'outside']) {
      const clip = hide(sequence(), [2]);
      if (condition === 'cut') clip.frames[2].discontinuity = 'cut';
      if (condition === 'shoulders') clip.frames[2].pose.quality.body = 0;
      if (condition === 'outside') clip.frames[2].body[15].x = 1.1;
      expect(reconstructTemporal(clip).frames[2].pose.evidence?.left.state).not.toBe('interpolated');
    }
  });
  it('withholds incompatible fingers independently of a recoverable palm', () => {
    const clip = hide(sequence(), [2]);
    clip.frames[3].pose.rotations['left.index.1'] = [Math.sin(.8), 0, 0, Math.cos(.8)];
    const evidence = reconstructTemporal(clip).frames[2].pose.evidence?.left;
    expect(evidence).toMatchObject({ orientation: 'interpolated', fingers: 'unavailable', reason: 'incompatible-handshape' });
  });
  it('rejects implausible inferred anatomy and fast unsupported arm motion', () => {
    const clip = hide(sequence(), [2], true);
    clip.frames[1].pose.rotations['left.index.1'] = [0, 0, Math.sin(.7), Math.cos(.7)];
    clip.frames[3].pose.rotations['left.index.1'] = [...clip.frames[1].pose.rotations['left.index.1']];
    expect(reconstructTemporal(clip).frames[2].pose.evidence?.left.fingers).toBe('unavailable');
    clip.frames[3].pose.rotations['left.upper'] = [0, 0, 0, 1];
    expect(reconstructTemporal(clip).frames[2].pose.evidence?.left.state).toBe('unavailable');
  });
  it('leaves leading/trailing missing observations unavailable beyond the brief hold', () => {
    const clip = hide(sequence([0, 33, 66, 100, 133, 166, 200, 233, 266]), [0, 1, 5, 6, 7, 8]);
    const result = reconstructTemporal(clip);
    expect(result.frames[0].pose.evidence?.left.state).toBe('unavailable');
    expect(result.frames[5].pose.evidence?.left.state).toBe('held');
    expect(result.frames[8].pose.evidence?.left.state).toBe('unavailable');
  });
  it('is mirror invariant, preserves the other hand, and keeps MotionClip v1 roundtrips', () => {
    const clip = sequence();
    clip.frames[2].hands = clip.frames[2].hands.slice(1); clip.frames[2].assignment = { right: 0 };
    const result = reconstructTemporal(clip);
    const mirror = reconstructTemporal({ ...clip, source: { ...clip.source, mirrored: true } });
    expect(result.frames).toEqual(mirror.frames);
    expect(result.frames[2].pose.rotations['right.wrist']).toEqual(clip.frames[2].pose.rotations['right.wrist']);
    expect(importMotion(exportMotion(clip))).toEqual(JSON.parse(exportMotion(clip)));
    expect(result.frames[2].pose.evidence?.left.state).toBe('interpolated');
  });
  it('cannot increase scoring coverage, similarity, DTW alignment, or change active boundaries', () => {
    const clip = hide(sequence(), [2]), learner = sequence();
    const before = compareMotion(clip, learner), originalFeatures = features(clip), interval = activeInterval(clip);
    const result = reconstructTemporal(clip);
    expect(result.frames[2].pose.evidence?.left.state).toBe('interpolated');
    expect(features(clip)).toEqual(originalFeatures);
    expect(activeInterval(clip)).toEqual(interval);
    expect(compareMotion(clip, learner)).toEqual(before);
    expect(compareMotion(learner, clip).metrics.find(m => m.component === 'handshape')?.coverage).toBeLessThan(1);
    expect(features(clip)[2].hands.left?.shape).toBeUndefined();
  });
  it('yields for mobile cancellation, reports progress, and matches the synchronous algorithm', async () => {
    const clip = sequence(), controller = new AbortController(), progress: string[] = [];
    const snapshot = exportMotion(clip);
    await expect(reconstructTemporalAsync(clip, { signal: controller.signal, progress: p => { progress.push(p.phase); controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress.length).toBeGreaterThan(0); expect(exportMotion(clip)).toBe(snapshot);
    expect((await reconstructTemporalAsync(clip)).frames).toEqual(reconstructTemporal(clip).frames);
    const aborted = new AbortController(); aborted.abort();
    await expect(reconstructTemporalAsync(clip, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('detects a large appearance cut while ignoring unchanged pixels', () => {
    const black = new Uint8ClampedArray(16 * 9 * 4), white = new Uint8ClampedArray(black.length).fill(255);
    expect(appearanceCut(black, black)).toBe(false); expect(appearanceCut(undefined, white)).toBe(false);
    expect(appearanceCut(black, white)).toBe(true);
  });
});
