// Pipeline 0.3.x metadata, compatibility and the learner temporal stage. Synthetic motion only, not KSL.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { fixtureClip } from './fixtures';
import { Reconstructor } from '../src/motion/reconstruct';
import { reconstructClip } from '../src/motion/comparison';
import { detectorFor } from '../src/motion/extract';
import { HAND_REGION_DEFAULTS } from '../src/motion/handRegions';
import { pipelineInfo, preservesSourcePalm, TEMPORAL_POLICY } from '../src/motion/pipeline';
import { editedPose } from '../src/motion/player';
import { exportMotion, importMotion } from '../src/motion/serialization';
import { eulerQuat, q, rad } from '../src/motion/math';
import { displayFor, fillHands, learnerStages, restPose, runDisplayPipeline, separate, stabilizeTorso, temporalReconstruct, TEMPORAL_STAGE, type TemporalReport } from '../src/motion/display';
import { MODELS, SIDES, type MotionClip } from '../src/motion/types';

/** 36 frames at 30 Hz of a slowly changing two-handed shape; hands hidden at the given frames. */
function clipWith(version: '0.2.0' | '0.3.1', hidden: number[] = []): MotionClip {
  const clip = fixtureClip(), solver = new Reconstructor();
  clip.pipeline = version === '0.3.1' ? pipelineInfo('synthetic-test-fixture-not-sign-language', HAND_REGION_DEFAULTS) : pipelineInfo('synthetic-test-fixture-not-sign-language');
  clip.source = { ...clip.source, sampleHz: 30, duration: 1.2 };
  clip.frames = Array.from({ length: 36 }, (_, i) => {
    const phase = i / 35;
    const d = articulatedDetection({ timestamp: i * 1000 / 30, flex: [.2 + phase * .3, .3, .2], spread: .1,
      palm: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phase * .6)) });
    for (const [wrist, index] of [[15, 0], [16, 1]]) d.hands[index].image[0] = { ...d.body[wrist] };
    if (hidden.includes(i)) d.hands = [];
    return solver.reconstruct(d);
  });
  return clip;
}
// Tracking states: the learner stages without the presentation-only rest pose (these synthetic hands start low).
const states = (clip: MotionClip, side: 'left' | 'right') => runDisplayPipeline({ clip }, learnerStages(undefined, { presentation: false })).frames.map(f => f.annotation.hands[side].state);

/** A clip as pipeline 0.3.0 recorded it (all-hands fusion record): read-only, no longer produced. */
function legacy(): MotionClip {
  const clip = clipWith('0.3.1'), { method: _method, fusion: _fusion, ...rest } = clip.pipeline.handRegions!;
  clip.pipeline = { ...clip.pipeline, version: '0.3.0', handRegions: { ...rest, method: 'pose-forearm-roi-v1', fusion: { rule: 'max-score-landmark-nms', sameHand: .35, sameHandOppositeLabel: .15, maxHands: 2 } } };
  return clip;
}

describe('pipeline metadata', () => {
  it('records exactly the 0.2.0 fields without region re-detection and the 0.3.1 parameters with it', () => {
    expect(pipelineInfo('detector')).toEqual({ version: '0.2.0', detector: 'detector', models: MODELS });
    expect(pipelineInfo('detector', HAND_REGION_DEFAULTS)).toEqual({ version: '0.3.1', detector: 'detector', models: MODELS, handRegions: { enabled: true, ...HAND_REGION_DEFAULTS }, temporal: TEMPORAL_POLICY });
    expect(detectorFor('0.2.0').handRegions).toBeUndefined();
    expect(detectorFor('0.3.1').handRegions).toEqual(HAND_REGION_DEFAULTS);
  });
  it('round-trips 0.3.1 records and hand origins inside schema 1 and keeps 0.2.0 clips unchanged', () => {
    const clip = clipWith('0.3.1');
    clip.frames[0].hands = clip.frames[0].hands.map((h, i) => ({ ...h, origin: i ? 'region' : 'frame' }));
    const restored = importMotion(exportMotion(clip));
    expect(restored.version).toBe(1);
    expect(restored.pipeline).toEqual(clip.pipeline);
    expect(restored.frames[0].hands.map(h => h.origin)).toEqual(['frame', 'region']);
    const old = clipWith('0.2.0'), text = exportMotion(old);
    expect(JSON.parse(exportMotion(importMotion(text)))).toEqual(JSON.parse(text)); // nothing added or dropped
    expect('handRegions' in importMotion(text).pipeline).toBe(false);
    expect(() => importMotion(exportMotion({ ...clip, pipeline: { ...clip.pipeline, handRegions: { ...clip.pipeline.handRegions!, cropSize: 8 } } }))).toThrow();
    expect(clip.pipeline.handRegions).toMatchObject({ method: 'pose-forearm-roi-v2-gapfill', fusion: { rule: 'gap-fill-per-side', perSide: 1 } });
    // Existing 0.3.0 clips (all-hands fusion record) still load unchanged.
    const old0 = legacy();
    expect(importMotion(exportMotion(old0)).pipeline).toEqual(old0.pipeline);
    expect((displayFor(importMotion(exportMotion(old0)), 'learner').reports[TEMPORAL_STAGE] as TemporalReport).applied).toBe(true);
  });
  it('keeps preserved-palm wrist edits for 0.2.0 and 0.3.x and the bounded wrist for 0.1.0', () => {
    expect(['0.1.0', '0.2.0', '0.3.0', '0.3.1', 'test'].map(preservesSourcePalm)).toEqual([false, true, true, true, false]);
    const wrist = (version: string) => {
      const clip = clipWith('0.2.0');
      clip.pipeline.version = version;
      clip.frames[3].pose.rotations['left.wrist'] = eulerQuat(rad(70), 0, 0).toArray() as [number, number, number, number];
      clip.edits = [{ frame: 3, side: 'left', degrees: [45, 0, 0] }];
      return q(editedPose(clip, 3).rotations['left.wrist']);
    };
    const expected = eulerQuat(rad(70), 0, 0).multiply(eulerQuat(rad(45), 0, 0));
    expect(wrist('0.3.1').angleTo(expected)).toBeLessThan(1e-6);
    expect(wrist('0.2.0').angleTo(expected)).toBeLessThan(1e-6);
    expect(wrist('0.1.0').angleTo(expected)).toBeGreaterThan(rad(20)); // 115° swing bounded to 85°
  });
  it('labels a re-solve by its detections: 0.3.0 stays 0.3.0, older clips become 0.2.0', () => {
    const current = reconstructClip(clipWith('0.3.1'), 'improved');
    expect(current.pipeline.version).toBe('0.3.1');
    expect(current.pipeline.handRegions?.enabled).toBe(true);
    expect(reconstructClip(clipWith('0.2.0'), 'improved').pipeline.version).toBe('0.2.0');
    expect(reconstructClip(clipWith('0.3.1'), 'original').pipeline.version).toBe('0.1.0');
    expect(reconstructClip(legacy(), 'improved').pipeline.version).toBe('0.3.0');
  });
});

describe('learner temporal stage', () => {
  const hidden = [0, 1, 2, 15, 16, 17];
  it('runs first for clips that record the 0.3.x policy, so short gaps are interpolated rather than filled', () => {
    const current = clipWith('0.3.1', hidden), previous = clipWith('0.2.0', hidden);
    const display = displayFor(current, 'learner'), report = display.reports[TEMPORAL_STAGE] as TemporalReport;
    expect(display.stages).toEqual([TEMPORAL_STAGE, 'torso-stabilize', 'hand-fill', 'rest-pose', 'hand-contact']);
    expect(report.applied).toBe(true);
    for (const side of SIDES) {
      expect(states(current, side).slice(15, 18)).toEqual(['interpolated', 'interpolated', 'interpolated']);
      expect(states(previous, side).slice(15, 18)).toEqual(['filled', 'filled', 'filled']);
      // Lead-in frames have no earlier observation to bridge from: both versions fill them.
      expect(states(current, side).slice(0, 3)).toEqual(['filled', 'filled', 'filled']);
    }
    const marked = display.frames.filter(f => f.annotation.stages.includes(TEMPORAL_STAGE)).length;
    expect(marked).toBe(3);
  });
  it('leaves 0.2.0 and published clips exactly as the previous learner preset showed them', () => {
    const files = ['ksl-thanks', 'ksl-sorry', 'ksl-meet'].map(id => importMotion(readFileSync(`public/content/assets/${id}/v1/reference.motion.json`, 'utf8')));
    for (const clip of [clipWith('0.2.0', hidden), ...files]) {
      const display = displayFor(clip, 'learner'), before = runDisplayPipeline({ clip }, [stabilizeTorso(), fillHands(), restPose(), separate()]);
      expect(display.frames).toEqual(before.frames);
      expect((display.reports[TEMPORAL_STAGE] as TemporalReport).reason).toBe('not-recorded');
    }
  });
  it('checks the rate and length conditions, never runs for attempts and never changes the stored clip', () => {
    const slow = clipWith('0.3.1', hidden); slow.source.sampleHz = 10;
    expect((displayFor(slow, 'learner').reports[TEMPORAL_STAGE] as TemporalReport).reason).toBe('sample-rate');
    const clip = clipWith('0.3.1', hidden), snapshot = JSON.stringify(clip);
    expect(displayFor(clip, 'attempt').stages).toEqual(['torso-stabilize']);
    displayFor(clip, 'learner');
    expect(JSON.stringify(clip)).toBe(snapshot);
    expect(() => runDisplayPipeline({ clip }, [stabilizeTorso(), temporalReconstruct()])).toThrow('first display stage');
  });
});
