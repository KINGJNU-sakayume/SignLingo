import type { HandDetection, HandRegionSettings, Landmark, Side } from './types';

/**
 * Pipeline 0.3.0 hand re-detection. Small hands (≈50 px in a 700 px frame) shrink to ≈15 px in the palm
 * detector's 192 px input and are missed. Each pose wrist predicts a square around its hand; the square is cut
 * from the decoded frame, upscaled and given to an IMAGE-mode HandLandmarker, and its landmarks are mapped back
 * to full-frame image coordinates. Pure: no MediaPipe or canvas code, so the geometry and fusion rules are
 * unit-tested; detectors inject the actual crop + inference.
 *
 * Left/right is NOT decided here. Fused hands go through the unchanged wrist association in tracking.ts.
 */
export const HAND_REGION_DEFAULTS: HandRegionSettings = {
  method: 'pose-forearm-roi-v1',
  cropSize: 320,
  sizeToForearm: 1.6,
  centerAlongHand: 0.35,
  minShoulderFraction: 0.55,
  minWristConfidence: 0.3,
  minGuideConfidence: 0.3,
  minRegionPixels: 32,
  cropSourceMaxDimension: 1920,
  fusion: { rule: 'max-score-landmark-nms', sameHand: 0.35, sameHandOppositeLabel: 0.15, maxHands: 2 },
  landmarker: { runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5 },
};

/** Axis-aligned square in source pixels. x0/y0 can lie outside the image only when `padded`. */
export type HandRegion = { side: Side; x0: number; y0: number; size: number; padded: boolean };
type Point = { x: number; y: number };

// Local copies of math.ts helpers keep three.js out of the inference worker bundle.
const finite = (p: Landmark | undefined): p is Landmark => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const confidence = (p: Landmark | undefined) => finite(p) ? Math.min(p.visibility ?? 1, p.presence ?? 1) : 0;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const POSE = { left: { wrist: 15, elbow: 13, pinky: 17, index: 19 }, right: { wrist: 16, elbow: 14, pinky: 18, index: 20 } } as const;

function predictRegion(body: Landmark[], side: Side, width: number, height: number, s: HandRegionSettings): HandRegion | null {
  const pixel = (p: Landmark): Point => ({ x: p.x * width, y: p.y * height });
  const guide = (i: number) => confidence(body[i]) >= s.minGuideConfidence;
  const at = POSE[side];
  if (confidence(body[at.wrist]) < s.minWristConfidence) return null;
  const wrist = pixel(body[at.wrist]);
  // Length scale: the forearm, floored by shoulder span because a forearm pointing at the camera looks short.
  const forearm = guide(at.elbow) ? distance(wrist, pixel(body[at.elbow])) : 0;
  const shoulders = guide(11) && guide(12) ? distance(pixel(body[11]), pixel(body[12])) : 0;
  const length = Math.max(forearm, s.minShoulderFraction * shoulders);
  if (!(length > 0)) return null;
  // Toward the hand: pose pinky/index knuckles when confident, otherwise along the forearm.
  let direction: Point | null = null;
  if (guide(at.pinky) && guide(at.index)) {
    const knuckles = pixel({ x: (body[at.pinky].x + body[at.index].x) / 2, y: (body[at.pinky].y + body[at.index].y) / 2, z: 0 });
    const d = distance(knuckles, wrist);
    if (d > 1e-6) direction = { x: (knuckles.x - wrist.x) / d, y: (knuckles.y - wrist.y) / d };
  }
  if (!direction && forearm > 1e-6) {
    const elbow = pixel(body[at.elbow]);
    direction = { x: (wrist.x - elbow.x) / forearm, y: (wrist.y - elbow.y) / forearm };
  }
  const offset = direction ? s.centerAlongHand * length : 0;
  const center = { x: wrist.x + (direction?.x ?? 0) * offset, y: wrist.y + (direction?.y ?? 0) * offset };
  const size = Math.min(Math.max(width, height), s.sizeToForearm * length);
  if (size < s.minRegionPixels) return null;
  // Slide the square back inside the image where it fits; pad (centered on the hand) only where it cannot.
  const place = (c: number, extent: number) => size <= extent ? Math.min(Math.max(c - size / 2, 0), extent - size) : Math.min(Math.max(c - size / 2, extent - size), 0);
  return { side, x0: place(center.x, width), y0: place(center.y, height), size, padded: size > width || size > height };
}

/** Predicted crop per anatomical side from one frame's pose image landmarks; null when there is no reliable wrist or scale. */
export function predictHandRegions(body: Landmark[], width: number, height: number, settings: HandRegionSettings = HAND_REGION_DEFAULTS): Record<Side, HandRegion | null> {
  if (body.length !== 33 || !(width > 0) || !(height > 0)) return { left: null, right: null };
  return { left: predictRegion(body, 'left', width, height, settings), right: predictRegion(body, 'right', width, height, settings) };
}

/**
 * Crop-normalized hand → full-frame normalized image coordinates. Image z shares x's scale, so it scales by
 * crop size over frame width. World landmarks are metric and hand-centered, independent of the crop.
 */
export function toFrameHand(hand: HandDetection, region: HandRegion, width: number, height: number): HandDetection {
  const image = hand.image.map(p => ({ ...p, x: (region.x0 + p.x * region.size) / width, y: (region.y0 + p.y * region.size) / height, z: p.z * region.size / width }));
  return { ...hand, image, origin: 'region' };
}

const usable = (h: HandDetection) => h.image.length === 21 && h.world.length === 21 && h.image.every(finite) && h.world.every(finite) && Number.isFinite(h.score);
/** Mean landmark distance between two estimates, in units of their mean palm length (wrist → middle MCP). */
export function handSeparation(a: HandDetection, b: HandDetection, width: number, height: number): number {
  const px = (p: Landmark): Point => ({ x: p.x * width, y: p.y * height });
  const palm = (h: HandDetection) => distance(px(h.image[0]), px(h.image[9]));
  const scale = (palm(a) + palm(b)) / 2;
  const mean = a.image.reduce((sum, p, i) => sum + distance(px(p), px(b.image[i])), 0) / a.image.length;
  return scale > 1e-9 ? mean / scale : mean > 1e-9 ? Infinity : 0;
}
/**
 * Confidence fusion: candidates are ordered by handedness score (the only per-hand confidence Tasks Vision
 * returns; a classification proxy, not localization accuracy), ties prefer the full-frame estimate, and a
 * candidate is suppressed when it is the same physical hand as one already kept. Same hand means corresponding
 * landmarks nearly coincide, not overlapping boxes, so two touching hands both survive. The winner is kept
 * whole: averaging two estimates would produce a hand neither model saw.
 */
export function fuseHands(frameHands: HandDetection[], regionHands: HandDetection[], width: number, height: number, fusion: HandRegionSettings['fusion'] = HAND_REGION_DEFAULTS.fusion): HandDetection[] {
  const candidates = [...frameHands.map(h => ({ ...h, origin: 'frame' as const })), ...regionHands.map(h => ({ ...h, origin: 'region' as const }))]
    .map((hand, order) => ({ hand, order })).filter(c => usable(c.hand));
  candidates.sort((a, b) => b.hand.score - a.hand.score || (a.hand.origin === b.hand.origin ? 0 : a.hand.origin === 'frame' ? -1 : 1) || a.order - b.order);
  const kept: HandDetection[] = [];
  for (const { hand } of candidates) {
    if (kept.length >= fusion.maxHands) break;
    const duplicate = kept.some(k => {
      const separation = handSeparation(k, hand, width, height);
      return separation < (k.label === hand.label ? fusion.sameHand : fusion.sameHandOppositeLabel);
    });
    if (!duplicate) kept.push(hand);
  }
  return kept;
}

/** Runs one frame's re-detection. `detectRegion` crops `region` from the source, upscales it and returns crop-normalized hands. */
export async function refineHands(input: {
  body: Landmark[]; frameHands: HandDetection[]; width: number; height: number; settings?: HandRegionSettings;
  detectRegion: (region: HandRegion) => HandDetection[] | Promise<HandDetection[]>;
}): Promise<{ hands: HandDetection[]; regions: Record<Side, HandRegion | null> }> {
  const settings = input.settings ?? HAND_REGION_DEFAULTS;
  const regions = predictHandRegions(input.body, input.width, input.height, settings);
  const regional: HandDetection[] = [];
  for (const region of [regions.left, regions.right]) {
    if (!region) continue;
    for (const hand of await input.detectRegion(region)) regional.push(toFrameHand(hand, region, input.width, input.height));
  }
  return { hands: fuseHands(input.frameHands, regional, input.width, input.height, settings.fusion), regions };
}
