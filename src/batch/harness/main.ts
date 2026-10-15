// Headless batch entry: the same extractMotion → exportMotion path as Motion Lab's "동작 추출 및 복원" and
// "JSON 내보내기", driven by Playwright. The file input receives the original file, so name and size match it.
import { detectorFor, extractMotion } from '../../motion/extract';
import type { LandmarkDetector } from '../../motion/detector';
import type { PipelineVersion } from '../../motion/pipeline';
import { exportMotion } from '../../motion/serialization';
import type { ExtractionMeasurements } from '../../motion/timing';
import type { Progress } from '../../motion/video';
import type { FusionRecord } from '../trace';

export type HarnessRun = { pipeline: PipelineVersion; sampleHz: number; mirrored: boolean; trace?: boolean };
export type HarnessResult = { json: string; measurements: ExtractionMeasurements | null; fusion?: FusionRecord[] };
declare global {
  interface Window {
    signlingoBatch: { run(options: HarnessRun): Promise<HarnessResult> };
    signlingoProgress?: (progress: Progress) => Promise<void>;
  }
}
window.signlingoBatch = {
  async run({ pipeline, sampleHz, mirrored, trace }) {
    const file = (document.getElementById('video') as HTMLInputElement).files?.[0];
    if (!file) throw new Error('No video was attached to the batch harness.');
    let measurements: ExtractionMeasurements | null = null, last = '';
    const progress = (p: Progress) => {
      // Throttled: each report is a round trip to the Node process.
      const key = `${p.phase}:${Math.floor(p.total ? p.done * 10 / p.total : 0)}`;
      if (key !== last) { last = key; void window.signlingoProgress?.(p); }
    };
    // With trace, the same detector is wrapped only to copy its per-frame fusion diagnostics (numbers, boxes).
    const inner = detectorFor(pipeline), fusion: FusionRecord[] = [];
    const detector: LandmarkDetector = trace ? {
      get id() { return inner.id; }, handRegions: inner.handRegions,
      initialize: () => inner.initialize(), close: () => inner.close(),
      async detect(frame, timestamp, detail) {
        const detection = detail ? await inner.detect(frame, timestamp, detail) : await inner.detect(frame, timestamp);
        if (inner.lastFusion) fusion.push({ timestamp, ...inner.lastFusion });
        return detection;
      },
    } : inner;
    const clip = await extractMotion(file, { pipeline, mirrored, sampleHz, signal: new AbortController().signal, progress, measurements: m => { measurements = m; } }, detector);
    return { json: exportMotion(clip), measurements, ...(trace ? { fusion } : {}) };
  },
};
