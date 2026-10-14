import { MediaPipeDetector, type LandmarkDetector } from './detector';
import { HAND_REGION_DEFAULTS } from './handRegions';
import type { PipelineVersion } from './pipeline';
import type { ExtractionMeasurements } from './timing';
import type { MotionClip } from './types';
import { processVideo, type Progress } from './video';

export type ExtractOptions = {
  pipeline: PipelineVersion; mirrored: boolean; sampleHz: number; signal: AbortSignal;
  progress: (p: Progress) => void; measurements?: (m: ExtractionMeasurements) => void;
};
/** 0.2.0: the full-frame detector exactly as before. 0.3.0: plus pose-guided hand-region re-detection. */
export function detectorFor(pipeline: PipelineVersion): LandmarkDetector {
  return pipeline === '0.3.0' ? new MediaPipeDetector(undefined, { handRegions: HAND_REGION_DEFAULTS }) : new MediaPipeDetector();
}
/**
 * Motion Lab's extraction path. The batch tool calls this same function in headless Chromium, so a batch
 * export and a Motion Lab export of the same file, rate, mirroring and pipeline are produced identically.
 */
export function extractMotion(file: File, { pipeline, ...options }: ExtractOptions, detector: LandmarkDetector = detectorFor(pipeline)): Promise<MotionClip> {
  return processVideo(file, detector, options);
}
