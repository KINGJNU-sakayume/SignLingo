import { LegacyReconstructor } from './legacy/reconstruct';
import { Reconstructor } from './reconstruct';
import type { MotionClip } from './types';
import { isRegionPipeline } from './pipeline';
// 0.3.x changed detection (hand-region re-detection), not the solver: re-solving a 0.3.x clip's stored
// detections keeps its label and metadata, and any older clip re-solved by the current solver is 0.2.0.
const improvedVersion = (clip: MotionClip) => isRegionPipeline(clip.pipeline.version) ? clip.pipeline.version : '0.2.0';
/** Re-solves the stored landmarks. Constraint corrections are pose-level, so the result is an uncorrected version 1 clip. */
export function reconstructClip(clip: MotionClip, pipeline: 'original' | 'improved'): MotionClip {
  const solver = pipeline === 'original' ? new LegacyReconstructor() : new Reconstructor();
  const { constraints: _constraints, ...source } = clip;
  return { ...source, version: 1, pipeline: { ...clip.pipeline, version: pipeline === 'original' ? '0.1.0' : improvedVersion(clip) }, frames: clip.frames.map(({timestamp,body,bodyWorld,hands,discontinuity})=>solver.reconstruct({timestamp,body,bodyWorld,hands,...(discontinuity?{discontinuity}:{})})), edits: [] };
}
