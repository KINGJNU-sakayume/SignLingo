import { LegacyReconstructor } from './legacy/reconstruct';
import { Reconstructor } from './reconstruct';
import type { MotionClip } from './types';
// 0.3.0 changed detection (hand-region re-detection), not the solver: re-solving a 0.3.0 clip's stored
// detections keeps its label and metadata, and any older clip re-solved by the current solver is 0.2.0.
const improvedVersion = (clip: MotionClip) => clip.pipeline.version === '0.3.0' ? '0.3.0' : '0.2.0';
export function reconstructClip(clip: MotionClip, pipeline: 'original' | 'improved'): MotionClip {
  const solver = pipeline === 'original' ? new LegacyReconstructor() : new Reconstructor();
  return { ...clip, pipeline: { ...clip.pipeline, version: pipeline === 'original' ? '0.1.0' : improvedVersion(clip) }, frames: clip.frames.map(({timestamp,body,bodyWorld,hands,discontinuity})=>solver.reconstruct({timestamp,body,bodyWorld,hands,...(discontinuity?{discontinuity}:{})})), edits: [] };
}
