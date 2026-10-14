import type { HandRegionSettings, PipelineInfo, TemporalPolicy } from './types';
import { MODELS } from './types';

export type PipelineVersion = '0.2.0' | '0.3.0';
export const PIPELINE_VERSIONS: readonly PipelineVersion[] = ['0.2.0', '0.3.0'];
export const TEMPORAL_POLICY: TemporalPolicy = { algorithm: 'conservative-bidirectional-v1', maxGapMs: 150, applies: 'learner-display' };

/**
 * What a clip records about how it was made. The version follows the detector actually used: a detector
 * without hand-region re-detection yields exactly the 0.2.0 metadata (Practice keeps this path); with it,
 * 0.3.0 records the crop/fusion parameters and the learner-display temporal policy. The solver is unchanged.
 */
export function pipelineInfo(detector: string, handRegions?: HandRegionSettings): PipelineInfo {
  if (!handRegions) return { version: '0.2.0', detector, models: MODELS };
  return { version: '0.3.0', detector, models: MODELS, handRegions: { enabled: true, ...handRegions }, temporal: TEMPORAL_POLICY };
}

/** 0.2.0 and later preserve the detected palm under a wrist edit; 0.1.0 (and unknown versions) keep the bounded wrist. */
export const preservesSourcePalm = (version: string) => version === '0.2.0' || version === '0.3.0';
