import { LegacyReconstructor } from './legacy/reconstruct';
import { Reconstructor } from './reconstruct';
import { PIPELINE_VERSION, type MotionClip } from './types';
export function reconstructClip(clip: MotionClip, pipeline: 'original' | 'improved'): MotionClip {
  const solver = pipeline === 'original' ? new LegacyReconstructor() : new Reconstructor();
  return { ...clip, pipeline: { ...clip.pipeline, version: pipeline === 'original' ? '0.1.0' : PIPELINE_VERSION }, frames: clip.frames.map(({timestamp,body,bodyWorld,hands,discontinuity})=>solver.reconstruct({timestamp,body,bodyWorld,hands,...(discontinuity?{discontinuity}:{})})), edits: [] };
}
