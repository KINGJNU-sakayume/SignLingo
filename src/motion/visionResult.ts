import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { refineHands } from './handRegions';
import { MODELS } from './types';
import type { HandDetection, HandRegionSettings, Landmark } from './types';

// Shared by the worker and the document-thread detector; type-only MediaPipe imports keep this bundle light.
// Hand Tasks do not estimate per-point visibility/presence. The JS wrapper
// materializes unset proto fields as zero; do not misreport them as observations.
export const cleanLandmarks = (points: Landmark[], hasConfidence = true): Landmark[] => points.map(p => ({
  x: p.x, y: p.y, z: p.z,
  ...(hasConfidence && Number.isFinite(p.visibility) ? { visibility: p.visibility } : {}),
  ...(hasConfidence && Number.isFinite(p.presence) ? { presence: p.presence } : {}),
}));
export const handsFrom = (h: HandLandmarkerResult): HandDetection[] => h.landmarks.map((landmarks, i) => ({
  image: cleanLandmarks(landmarks, false),
  world: cleanLandmarks(h.worldLandmarks[i] ?? [], false),
  label: h.handedness[i]?.[0]?.categoryName ?? 'Unknown',
  score: h.handedness[i]?.[0]?.score ?? 0,
}));
/** The crop landmarker runs in IMAGE mode: crops move every frame, so VIDEO-mode tracking would follow stale crop coordinates. */
export const regionLandmarkerOptions = (s: HandRegionSettings) => ({
  baseOptions: { modelAssetPath: MODELS.hand, delegate: 'CPU' as const },
  runningMode: s.landmarker.runningMode, numHands: s.landmarker.numHands,
  minHandDetectionConfidence: s.landmarker.minHandDetectionConfidence, minHandPresenceConfidence: s.landmarker.minHandPresenceConfidence,
});

type Surface = OffscreenCanvas | HTMLCanvasElement;
/**
 * Cuts each predicted square out of `source` (the decoded frame, at up to cropSourceMaxDimension), upscales it
 * onto `surface` and runs the crop landmarker; the result is fused with the full-frame hands.
 */
export async function detectWithRegions(input: {
  body: Landmark[]; frameHands: HandDetection[]; source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  surface: Surface; landmarker: Pick<HandLandmarker, 'detect'>; settings: HandRegionSettings;
}): Promise<HandDetection[]> {
  const { surface, settings, source } = input, size = settings.cropSize;
  if (surface.width !== size || surface.height !== size) { surface.width = size; surface.height = size; }
  const context = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Canvas 2D is unavailable for hand-region crops.');
  const { hands } = await refineHands({ body: input.body, frameHands: input.frameHands, width: source.width, height: source.height, settings,
    detectRegion: region => {
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      // Source rectangles beyond the frame are clipped; the uncovered crop stays transparent black padding.
      context.drawImage(source, region.x0, region.y0, region.size, region.size, 0, 0, size, size);
      return handsFrom(input.landmarker.detect(surface));
    } });
  return hands;
}
