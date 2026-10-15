import { assignHandsDetailed, MIN_HAND_SCORE, WRIST_GATE } from './association';
import { confidence, valid } from './landmark';
import { SIDES, type Detection, type HandDetection, type HandRegionSettings, type Landmark, type Side } from './types';

/**
 * Pipeline 0.3.1 hand re-detection, gap-fill only. Small hands (≈50 px in a 700 px frame) shrink to ≈15 px in
 * the palm detector's 192 px input and are missed. The full-frame detection is kept exactly as it is; only a
 * side the wrist rule (association.ts) leaves without a hand gets a square predicted from its pose wrist, cut
 * from the decoded frame, upscaled and given to an IMAGE-mode HandLandmarker. At most one region hand per side
 * is added, chosen by distance to that side's wrist, never by handedness label, and only if the same wrist rule
 * then keeps every full-frame assignment and places the new hand on its own side. Pure: detectors inject the
 * crop + inference, so the geometry and selection rules are unit-tested.
 *
 * 0.3.0 let region hands compete with full-frame hands by score (top 2 kept). With two nearby hands, a crop could
 * relabel one of them so that two "Left" estimates displaced the right hand and both sides were withheld.
 */
export const HAND_REGION_DEFAULTS: HandRegionSettings = {
  method: 'pose-forearm-roi-v2-gapfill',
  cropSize: 320,
  sizeToForearm: 1.6,
  centerAlongHand: 0.35,
  minShoulderFraction: 0.55,
  // A fill can only be assigned to a wrist the association trusts.
  minWristConfidence: 0.45,
  minGuideConfidence: 0.3,
  minRegionPixels: 32,
  cropSourceMaxDimension: 1920,
  fusion: { rule: 'gap-fill-per-side', sameHand: 0.35, maxWristDistance: WRIST_GATE, minScore: MIN_HAND_SCORE, perSide: 1 },
  landmarker: { runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5 },
};

/** Axis-aligned square in source pixels. x0/y0 can lie outside the image only when `padded`. */
export type HandRegion = { side: Side; x0: number; y0: number; size: number; padded: boolean };
type Point = { x: number; y: number };
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

const usable = (h: HandDetection) => h.image.length === 21 && h.world.length === 21 && h.image.every(valid) && h.world.every(valid) && Number.isFinite(h.score);
/** Mean landmark distance between two estimates, in units of their mean palm length (wrist → middle MCP). */
export function handSeparation(a: HandDetection, b: HandDetection, width: number, height: number): number {
  const px = (p: Landmark): Point => ({ x: p.x * width, y: p.y * height });
  const palm = (h: HandDetection) => distance(px(h.image[0]), px(h.image[9]));
  const scale = (palm(a) + palm(b)) / 2;
  const mean = a.image.reduce((sum, p, i) => sum + distance(px(p), px(b.image[i])), 0) / a.image.length;
  return scale > 1e-9 ? mean / scale : mean > 1e-9 ? Infinity : 0;
}

export type FusionDrop = {
  /** The side whose region produced the candidate. */
  side: Side; label: string; score: number;
  reason: 'invalid' | 'low-score' | 'duplicate' | 'far-from-wrist' | 'not-best' | 'no-room' | 'rejected-by-tracking';
};
type Candidate = { side: Side; hand: HandDetection; distance: number };
const asDetection = (body: Landmark[], hands: HandDetection[]): Detection => ({ timestamp: 0, body, bodyWorld: [], hands });

/**
 * Gap-fill selection. Full-frame hands are returned unchanged (tagged `origin: 'frame'`). For each side with
 * region candidates, the nearest usable candidate to that side's pose wrist wins; a candidate that repeats a
 * full-frame hand is dropped; if both sides picked the same hand, the nearer wrist keeps it. Fills never push the
 * total past two hands and are kept only if the wrist rule still assigns every full-frame hand as before and
 * puts each fill on its own side (otherwise the farthest fill is dropped and the rest re-checked).
 */
export function gapFill(input: {
  body: Landmark[]; frameHands: HandDetection[]; regionHands: Partial<Record<Side, HandDetection[]>>;
  width: number; height: number; fusion?: HandRegionSettings['fusion'];
}): { hands: HandDetection[]; fills: Partial<Record<Side, number>>; dropped: FusionDrop[] } {
  const fusion = input.fusion ?? HAND_REGION_DEFAULTS.fusion, { width, height } = input;
  const frame = input.frameHands.map(h => ({ ...h, origin: 'frame' as const }));
  const base = assignHandsDetailed(asDetection(input.body, frame)).assignment;
  const dropped: FusionDrop[] = [];
  const drop = (side: Side, hand: HandDetection, reason: FusionDrop['reason']) => dropped.push({ side, label: hand.label, score: hand.score, reason });
  const eligible: Record<Side, Candidate[]> = { left: [], right: [] };
  for (const side of SIDES) {
    const wrist = input.body[side === 'left' ? 15 : 16];
    for (const hand of input.regionHands[side] ?? []) {
      if (!usable(hand)) { drop(side, hand, 'invalid'); continue; }
      if (hand.score < fusion.minScore) { drop(side, hand, 'low-score'); continue; }
      if (frame.some(f => usable(f) && handSeparation(f, hand, width, height) < fusion.sameHand)) { drop(side, hand, 'duplicate'); continue; }
      const d = confidence(wrist) >= .45 ? Math.hypot(wrist.x - hand.image[0].x, wrist.y - hand.image[0].y) : Infinity;
      if (!(d <= fusion.maxWristDistance)) { drop(side, hand, 'far-from-wrist'); continue; }
      eligible[side].push({ side, hand, distance: d });
    }
    eligible[side].sort((a, b) => a.distance - b.distance || b.hand.score - a.hand.score);
  }
  // One per side. Overlapping crops can return the same hand to both sides: the nearer wrist keeps it.
  const next: Record<Side, number> = { left: 0, right: 0 };
  for (;;) {
    const l = eligible.left[next.left], r = eligible.right[next.right];
    if (!l || !r || handSeparation(l.hand, r.hand, width, height) >= fusion.sameHand) break;
    if (l.distance <= r.distance) { drop('right', r.hand, 'duplicate'); next.right++; } else { drop('left', l.hand, 'duplicate'); next.left++; }
  }
  const picks: Candidate[] = [];
  for (const side of SIDES) {
    const chosen = eligible[side][next[side]];
    if (!chosen) continue;
    picks.push(chosen);
    for (const other of eligible[side].slice(next[side] + 1)) drop(side, other.hand, 'not-best');
  }
  picks.sort((a, b) => a.distance - b.distance);
  const room = Math.max(0, 2 - frame.length);
  for (const c of picks.slice(room)) drop(c.side, c.hand, 'no-room');
  const fills = picks.slice(0, room);
  while (fills.length) {
    const hands = [...frame, ...fills.map(c => c.hand)];
    const after = assignHandsDetailed(asDetection(input.body, hands)).assignment;
    const kept = SIDES.every(side => base[side] === undefined || after[side] === base[side]);
    const placed = fills.every((c, k) => after[c.side] === frame.length + k);
    if (kept && placed) return { hands, fills: Object.fromEntries(fills.map((c, k) => [c.side, frame.length + k])), dropped };
    const farthest = fills.pop()!;
    drop(farthest.side, farthest.hand, 'rejected-by-tracking');
  }
  return { hands: frame, fills: {}, dropped };
}

/**
 * Numbers and coordinates only, for `motion:compare --trace`: candidate counts, the sides that needed a fill,
 * predicted boxes (crop-source pixels), what was kept and what was dropped. Never stored in a MotionClip; no pixels.
 */
export type FusionTrace = {
  source: { width: number; height: number };
  candidates: { frame: number; region: number };
  /** Sides the wrist rule left without a full-frame hand. */
  gaps: Side[];
  /** No region ran: every side already had a hand, or the full frame already holds two hands. */
  skipped?: 'no-gap' | 'no-room';
  regions: Record<Side, { x0: number; y0: number; size: number } | null>;
  kept: { origin: 'frame' | 'region'; label: string; score: number; side?: Side }[];
  dropped: FusionDrop[];
};

/** Runs one frame's gap-fill. `detectRegion` crops `region` from the source, upscales it and returns crop-normalized hands. */
export async function refineHands(input: {
  body: Landmark[]; frameHands: HandDetection[]; width: number; height: number; settings?: HandRegionSettings;
  detectRegion: (region: HandRegion) => HandDetection[] | Promise<HandDetection[]>;
}): Promise<{ hands: HandDetection[]; regions: Record<Side, HandRegion | null>; trace: FusionTrace }> {
  const settings = input.settings ?? HAND_REGION_DEFAULTS, { width, height } = input;
  const base = assignHandsDetailed(asDetection(input.body, input.frameHands)).assignment;
  const gaps = SIDES.filter(side => base[side] === undefined);
  // A frame that already holds two hands is left as the full-frame pass produced it (no region inference).
  const skipped = !gaps.length ? 'no-gap' as const : input.frameHands.length >= 2 ? 'no-room' as const : undefined;
  const predicted = skipped ? { left: null, right: null } : predictHandRegions(input.body, width, height, settings);
  const regions: Record<Side, HandRegion | null> = { left: gaps.includes('left') ? predicted.left : null, right: gaps.includes('right') ? predicted.right : null };
  const regionHands: Record<Side, HandDetection[]> = { left: [], right: [] };
  for (const side of SIDES) {
    const region = regions[side];
    if (region) for (const hand of await input.detectRegion(region)) regionHands[side].push(toFrameHand(hand, region, width, height));
  }
  const { hands, fills, dropped } = gapFill({ body: input.body, frameHands: input.frameHands, regionHands, width, height, fusion: settings.fusion });
  const box = (r: HandRegion | null) => r && { x0: r.x0, y0: r.y0, size: r.size };
  const fillSide = (i: number) => SIDES.find(side => fills[side] === i);
  return { hands, regions, trace: {
    source: { width, height }, candidates: { frame: input.frameHands.length, region: regionHands.left.length + regionHands.right.length },
    gaps, ...(skipped ? { skipped } : {}), regions: { left: box(regions.left), right: box(regions.right) },
    kept: hands.map((h, i) => { const side = fillSide(i); return { origin: h.origin ?? 'frame', label: h.label, score: h.score, ...(side ? { side } : {}) }; }),
    dropped } };
}
