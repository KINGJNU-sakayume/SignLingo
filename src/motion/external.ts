import { z } from 'zod';
import { Reconstructor } from './reconstruct';
import { PIPELINE_VERSION, SPACES } from './types';
import type { Detection, MotionClip } from './types';

/**
 * `signlingo.detections` v1: raw landmarks from an extractor that runs outside the browser (e.g. MediaPipe
 * Python with the heavy pose model on the operator's PC, `tools/extract/`). It carries exactly the
 * `Detection` contract of `LandmarkDetector`: MediaPipe pose 33 + hands 21, normalized image coordinates of
 * the unmirrored pixels, and estimated world meters. A model with another joint convention must convert to
 * this before writing the file. Reconstruction is NOT done by the extractor: `motionFromDetections` runs the
 * same solver as Motion Lab, so the MotionClip records solver 0.2.0 and the external detector id.
 */
const num = z.number().finite();
const unit = num.min(0).max(1);
const point = z.object({ x: num, y: num, z: num, visibility: unit.optional(), presence: unit.optional() }).strict();
const body = z.array(point).refine(a => a.length === 0 || a.length === 33, 'Expected 0 or 33 pose landmarks');
const hand = z.object({ image: z.array(point).length(21), world: z.array(point).length(21), label: z.string().max(30), score: unit }).strict();
const frame = z.object({ timestamp: num.min(0), body, bodyWorld: body, hands: z.array(hand).max(2), discontinuity: z.literal('cut').optional() }).strict();
export const detectionsSchema = z.object({
  format: z.literal('signlingo.detections'), version: z.literal(1),
  detector: z.string().min(1).max(100),
  models: z.record(z.string(), z.string().max(1000)),
  modelSha256: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
  source: z.object({
    name: z.string().min(1).max(500), size: num.int().min(0), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    duration: num.positive().max(120), timeOffset: num.min(0).max(120).optional(),
    width: num.int().positive().max(16384), height: num.int().positive().max(16384),
    mirrored: z.boolean(), sampleHz: num.min(1).max(60),
  }).strict(),
  /** Free-form record of how the extractor ran (decoder, analysis size, delegate). Kept out of the MotionClip. */
  analysis: z.record(z.string(), z.union([z.string().max(200), num, z.boolean(), z.null()])).optional(),
  frames: z.array(frame).min(1).max(7200),
}).strict();
export type DetectionsFile = z.infer<typeof detectionsSchema>;

export function parseDetections(text: string): DetectionsFile {
  if (text.length > 200 * 1024 * 1024) throw new Error('Detections JSON exceeds the 200 MB limit.');
  const doc = detectionsSchema.parse(JSON.parse(text));
  if (doc.frames[0].timestamp !== 0) throw new Error('Detections must start at timestamp zero (store the first sample time in source.timeOffset).');
  if (doc.frames.some((f, i) => i > 0 && f.timestamp <= doc.frames[i - 1].timestamp)) throw new Error('Detection timestamps must increase strictly.');
  if (doc.frames.at(-1)!.timestamp >= doc.source.duration * 1000 + 1) throw new Error('Detection timestamps must lie within source.duration.');
  return doc;
}

/** Reconstructs external detections with the Motion Lab solver. Same failure rule: no reliable upper body, no clip. */
export function motionFromDetections(doc: DetectionsFile): MotionClip {
  const reconstruction = new Reconstructor();
  const frames = doc.frames.map(f => reconstruction.reconstruct(f as Detection));
  if (!frames.some(f => f.pose.quality.body > 0)) throw new Error('No reliable upper-body pose was detected. Keep one signer, both shoulders and hands visible. No animation was generated.');
  const { sha256: _sha, ...source } = doc.source;
  return {
    schema: 'signlingo.motion', version: 1, language: 'ksl',
    pipeline: { version: PIPELINE_VERSION, detector: doc.detector, models: doc.models },
    source: { ...source, timeOffset: source.timeOffset ?? 0 },
    spaces: SPACES,
    nonmanual: { head: 'Approximate nose/ear orientation; not facial grammar.', face: 'not-estimated', linguisticValidation: 'not-performed' },
    frames, edits: [],
  };
}
