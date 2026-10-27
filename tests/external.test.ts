// signlingo.detections (local extractor output) → MotionClip with the Motion Lab solver. Synthetic geometry only.
import { describe, expect, it } from 'vitest';
import { articulatedDetection } from './articulation';
import { parseArgs } from '../src/batch/args';
import { motionFromDetections, parseDetections, type DetectionsFile } from '../src/motion/external';
import { Reconstructor } from '../src/motion/reconstruct';
import { exportMotion, importMotion } from '../src/motion/serialization';
import { PIPELINE_VERSION } from '../src/motion/types';

const detections = (count = 6): DetectionsFile => ({
  format: 'signlingo.detections', version: 1, detector: 'mediapipe-python@1.1.0/pose-heavy',
  models: { pose: 'https://example.invalid/pose_landmarker_heavy.task', hand: 'https://example.invalid/hand_landmarker.task' },
  source: { name: 'clip.webm', size: 1234, duration: count / 30 + .05, timeOffset: .02, width: 1180, height: 1540, mirrored: false, sampleHz: 30 },
  frames: Array.from({ length: count }, (_, i) => {
    const { timestamp, body, bodyWorld, hands } = articulatedDetection({ timestamp: Math.round(i * 1000 / 30), flex: [.2 + i / 50, .3, .2] });
    return { timestamp, body, bodyWorld, hands: hands.map(({ image, world, label, score }) => ({ image, world, label, score })) };
  }),
});

describe('signlingo.detections import', () => {
  it('reconstructs with the Motion Lab solver and records the external detector', () => {
    const doc = parseDetections(JSON.stringify(detections()));
    const clip = motionFromDetections(doc);
    const solver = new Reconstructor();
    expect(clip.frames.map(f => f.pose)).toEqual(doc.frames.map(f => solver.reconstruct(f).pose));
    expect(clip.pipeline).toEqual({ version: PIPELINE_VERSION, detector: 'mediapipe-python@1.1.0/pose-heavy', models: doc.models });
    expect(clip.source).toEqual({ name: 'clip.webm', size: 1234, duration: doc.source.duration, timeOffset: .02, width: 1180, height: 1540, mirrored: false, sampleHz: 30 });
    // The same strict importer as Motion Lab exports (content prepare reads it).
    expect(importMotion(exportMotion(clip)).frames).toHaveLength(6);
  });
  it('keeps the source hash out of the MotionClip', () => {
    const doc = detections(); doc.source.sha256 = 'a'.repeat(64);
    expect(motionFromDetections(parseDetections(JSON.stringify(doc))).source).not.toHaveProperty('sha256');
  });
  it.each([
    ['nonzero start', (d: DetectionsFile) => { d.frames[0].timestamp = 5; }, 'timestamp zero'],
    ['non-increasing', (d: DetectionsFile) => { d.frames[2].timestamp = d.frames[1].timestamp; }, 'increase strictly'],
    ['beyond duration', (d: DetectionsFile) => { d.source.duration = .05; }, 'within source.duration'],
  ])('rejects %s timestamps', (_, change, message) => {
    const doc = detections(); change(doc);
    expect(() => parseDetections(JSON.stringify(doc))).toThrow(message);
  });
  it('rejects other joint conventions and unknown fields', () => {
    const short = detections(); short.frames[0].body = short.frames[0].body.slice(0, 17);
    expect(() => parseDetections(JSON.stringify(short))).toThrow();
    expect(() => parseDetections(JSON.stringify({ ...detections(), extra: 1 }))).toThrow();
  });
  it('refuses a clip without any upper body, like Motion Lab', () => {
    const doc = detections(); for (const f of doc.frames) { f.body = []; f.bodyWorld = []; }
    expect(() => motionFromDetections(doc)).toThrow('No reliable upper-body pose');
  });
  it('parses motion:import arguments', () => {
    expect(parseArgs(['import', 'private-data/exports/heavy', '--out', 'o', '--videos', 'v', '--constraints', 'c'])).toMatchObject({ command: 'import', out: 'o', videos: 'v', constraints: 'c', report: 'work/import-report.json' });
    expect(() => parseArgs(['import', 'x.detections.json'])).toThrow('--out');
    expect(() => parseArgs(['import', 'x.detections.json', '--out', 'o', '--hz', '15'])).toThrow('추출기');
    expect(() => parseArgs(['batch', 'a.webm', '--out', 'o', '--videos', 'v'])).toThrow('--videos');
  });
});
