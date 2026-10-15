// Pipeline 0.3.1 hand-region geometry and gap-fill. Synthetic landmarks only; no MediaPipe, no signer.
import { describe, expect, it, vi } from 'vitest';
import { gapFill, HAND_REGION_DEFAULTS, handSeparation, predictHandRegions, refineHands, toFrameHand, type HandRegion } from '../src/motion/handRegions';
import { Reconstructor } from '../src/motion/reconstruct';
import { detection } from './fixtures';
import { detectWithRegions } from '../src/motion/visionResult';
import { assignHands } from '../src/motion/tracking';
import type { HandDetection, Landmark } from '../src/motion/types';

const W = 700, H = 466;
const point = (x: number, y: number, visibility = .95): Landmark => ({ x, y, z: 0, visibility, presence: visibility });
/** Upper body facing the camera; hands raised with forearms vertical. Pose finger landmarks hidden unless given. */
function body(overrides: Record<number, Landmark> = {}): Landmark[] {
  const points = Array.from({ length: 33 }, () => point(.5, .5, 0));
  Object.assign(points, { 11: point(.6, .35), 12: point(.4, .35), 13: point(.62, .75), 14: point(.38, .75), 15: point(.62, .55), 16: point(.38, .55) }, overrides);
  return points;
}
/** A 21-point hand in normalized image coordinates: wrist at (x, y), fingers fanned in `direction` (radians from +x). */
function hand(x: number, y: number, options: { scale?: number; direction?: number; label?: string; score?: number } = {}): HandDetection {
  const { scale = .05, direction = -Math.PI / 2, label = 'Left', score = .9 } = options;
  const image = [{ x, y, z: 0 }];
  for (let f = 0; f < 5; f++) for (let j = 1; j <= 4; j++) {
    const angle = direction + (f - 2) * .25, r = scale * (.35 + j * .2);
    image.push({ x: x + Math.cos(angle) * r * H / W, y: y + Math.sin(angle) * r, z: -.01 * j });
  }
  const world = image.map((p, i) => ({ x: (p.x - x) * .3, y: (p.y - y) * .3, z: i * .001 }));
  return { image, world, label, score };
}

describe('predicted hand regions', () => {
  it('sizes the square in proportion to the image-space forearm and centers it toward the hand', () => {
    const left = predictHandRegions(body(), W, H).left!;
    const forearm = .2 * H; // wrist (0.62, 0.55) to elbow (0.62, 0.75)
    expect(left.size).toBeCloseTo(HAND_REGION_DEFAULTS.sizeToForearm * forearm, 9);
    expect(left.x0 + left.size / 2).toBeCloseTo(.62 * W, 9);
    expect(left.y0 + left.size / 2).toBeCloseTo(.55 * H - HAND_REGION_DEFAULTS.centerAlongHand * forearm, 9);
    const longer = predictHandRegions(body({ 13: point(.62, .95) }), W, H).left!;
    expect(longer.size / left.size).toBeCloseTo(2, 9);
  });
  it('measures in aspect-correct pixels of a 700×466 frame', () => {
    const vertical = predictHandRegions(body({ 15: point(.5, .5), 13: point(.5, .7) }), W, H).left!;
    const horizontal = predictHandRegions(body({ 15: point(.5, .5), 13: point(.7, .5) }), W, H).left!;
    expect(horizontal.size / vertical.size).toBeCloseTo(W / H, 9);
  });
  it('floors a foreshortened forearm by shoulder span and survives a missing elbow', () => {
    const span = .2 * W, floor = HAND_REGION_DEFAULTS.minShoulderFraction * span;
    expect(predictHandRegions(body({ 13: point(.62, .56) }), W, H).left!.size).toBeCloseTo(HAND_REGION_DEFAULTS.sizeToForearm * floor, 9);
    const noElbow = predictHandRegions(body({ 13: point(.62, .75, .1) }), W, H).left!;
    expect(noElbow.size).toBeCloseTo(HAND_REGION_DEFAULTS.sizeToForearm * floor, 9);
    expect(noElbow.x0 + noElbow.size / 2).toBeCloseTo(.62 * W, 9); // no direction evidence: centered on the wrist
    expect(predictHandRegions(body({ 13: point(.62, .75, .1), 11: point(.6, .35, .1) }), W, H).left).toBeNull();
  });
  it('withholds a region without a reliable wrist and follows pose knuckles when they are visible', () => {
    expect(predictHandRegions(body({ 15: point(.62, .55, .2) }), W, H).left).toBeNull();
    expect(predictHandRegions(body({ 15: point(.62, .55, .2) }), W, H).right).not.toBeNull();
    const knuckles = predictHandRegions(body({ 17: point(.66, .55), 19: point(.66, .53) }), W, H).left!;
    expect(knuckles.x0 + knuckles.size / 2).toBeGreaterThan(.62 * W + 20); // pointing right, not up the forearm
    expect(predictHandRegions([], W, H)).toEqual({ left: null, right: null });
  });
  it('slides a square back inside the frame where it fits and pads only where it cannot', () => {
    const edge = predictHandRegions(body({ 15: point(.01, .5), 13: point(.01, .7) }), W, H).left!;
    expect(edge.x0).toBe(0);
    expect(edge.padded).toBe(false);
    const huge = predictHandRegions(body({ 15: point(.5, .5), 13: point(.5, 1.15) }), W, H).left!; // 1.6 × 303 px > 466 px
    expect(huge.padded).toBe(true);
    expect(huge.y0).toBeLessThanOrEqual(0);
    expect(huge.y0 + huge.size).toBeGreaterThanOrEqual(H);
    expect(huge.x0).toBeGreaterThanOrEqual(0);
    expect(huge.x0 + huge.size).toBeLessThanOrEqual(W);
  });
});

describe('crop to frame coordinates', () => {
  const toCrop = (h: HandDetection, r: HandRegion): HandDetection => ({ ...h, image: h.image.map(p => ({ ...p, x: (p.x * W - r.x0) / r.size, y: (p.y * H - r.y0) / r.size, z: p.z * W / r.size })) });
  it.each([
    ['inside', { side: 'left', x0: 300, y0: 120, size: 150, padded: false }],
    ['padded beyond the top-left corner', { side: 'right', x0: -40, y0: -60, size: 520, padded: true }],
  ] as const)('inverts the crop transform exactly (%s)', (_name, region) => {
    const source = hand(.5, .4);
    const restored = toFrameHand(toCrop(source, region), region, W, H);
    restored.image.forEach((p, i) => {
      expect(p.x).toBeCloseTo(source.image[i].x, 12); expect(p.y).toBeCloseTo(source.image[i].y, 12); expect(p.z).toBeCloseTo(source.image[i].z, 12);
    });
    expect(restored.world).toEqual(source.world); // metric, crop-independent
    expect(restored.origin).toBe('region');
  });
});

/** A fake crop detector that sees `inFrame` hands through the given region, in crop coordinates. */
const seeing = (inFrame: HandDetection[]) => (region: HandRegion) => inFrame
  .filter(h => h.image[0].x * W > region.x0 && h.image[0].x * W < region.x0 + region.size && h.image[0].y * H > region.y0 && h.image[0].y * H < region.y0 + region.size)
  .map(h => ({ ...h, image: h.image.map(p => ({ ...p, x: (p.x * W - region.x0) / region.size, y: (p.y * H - region.y0) / region.size, z: p.z * W / region.size })) }));
const withoutOrigin = (hands: HandDetection[]) => hands.map(({ origin: _origin, ...h }) => h);
const assigned = (pose: Landmark[], hands: HandDetection[]) => assignHands({ timestamp: 0, body: pose, bodyWorld: pose, hands }).assignment;
// Two nearby hands, 0.08 image widths apart: the overlapping-crop situation that broke 0.3.0.
const close = body({ 15: point(.52, .55), 13: point(.54, .75), 16: point(.44, .55), 14: point(.42, .75) });
const leftHand = hand(.52, .545, { label: 'Left', score: .97 }), rightHand = hand(.44, .545, { label: 'Right', score: .91, direction: -Math.PI / 2 - .3 });

describe('0.3.1 gap-fill', () => {
  it('leaves a frame whose full-frame pass found both hands exactly as 0.2.0 stored it, without running any crop', async () => {
    const detectRegion = vi.fn(seeing([{ ...leftHand, score: .98 }, { ...rightHand, label: 'Left', score: .98 }]));
    const result = await refineHands({ body: close, frameHands: [leftHand, rightHand], width: W, height: H, detectRegion });
    expect(detectRegion).not.toHaveBeenCalled();
    expect(withoutOrigin(result.hands)).toEqual([leftHand, rightHand]);
    expect(result.trace).toMatchObject({ gaps: [], skipped: 'no-gap', candidates: { frame: 2, region: 0 }, regions: { left: null, right: null }, dropped: [] });
    // Two full-frame hands with one unassigned: still no room for a fill, still 0.2.0.
    const stray = hand(.95, .1, { label: 'Right', score: .9 });
    const partial = await refineHands({ body: close, frameHands: [leftHand, stray], width: W, height: H, detectRegion });
    expect(detectRegion).not.toHaveBeenCalled();
    expect(withoutOrigin(partial.hands)).toEqual([leftHand, stray]);
    expect(partial.trace).toMatchObject({ gaps: ['right'], skipped: 'no-room' });
  });
  it('reconstructs the same pose as 0.2.0 when the full frame found two hands', async () => {
    const d = detection(), { hands } = await refineHands({ body: d.body, frameHands: d.hands, width: 640, height: 480, detectRegion: () => { throw new Error('no crop expected'); } });
    const a = new Reconstructor().reconstruct(d), b = new Reconstructor().reconstruct({ ...d, hands });
    expect(b.assignment).toEqual(a.assignment);
    expect(b.pose).toEqual(a.pose);
  });
  it('keeps both hands when an overlapping crop returns two "Left" hands for the empty side', async () => {
    // Full frame found only the left hand; the right crop also sees the left hand and labels the right hand "Left".
    const detectRegion = vi.fn((region: HandRegion) => region.side === 'right' ? seeing([{ ...leftHand, score: .98 }, { ...rightHand, label: 'Left', score: .98 }])(region) : []);
    const { hands, trace } = await refineHands({ body: close, frameHands: [leftHand], width: W, height: H, detectRegion });
    expect(detectRegion).toHaveBeenCalledTimes(1);
    expect(hands.map(h => [h.origin, h.label])).toEqual([['frame', 'Left'], ['region', 'Left']]);
    expect(assigned(close, hands)).toEqual({ left: 0, right: 1 });
    expect(trace.gaps).toEqual(['right']);
    expect(trace.kept).toEqual([{ origin: 'frame', label: 'Left', score: .97 }, { origin: 'region', label: 'Left', score: .98, side: 'right' }]);
    expect(trace.dropped).toEqual([{ side: 'right', label: 'Left', score: .98, reason: 'duplicate' }]);
    // Neither hand found by the full frame: each side takes the candidate nearest its own wrist, labels ignored.
    const both = await refineHands({ body: close, frameHands: [], width: W, height: H, detectRegion: seeing([{ ...rightHand, label: 'Left', score: .98 }, { ...leftHand, score: .97 }]) });
    expect(both.hands.map(h => h.image[0].x)).toEqual([.52, .44].map(x => expect.closeTo(x, 9)));
    expect(assigned(close, both.hands)).toEqual({ left: 0, right: 1 });
  });
  it('never displaces a full-frame hand: a fill that changes an existing assignment is rejected', () => {
    const pose = body({ 15: point(.50, .55), 13: point(.50, .75), 16: point(.58, .55), 14: point(.58, .75) });
    const a = hand(.53, .55, { label: 'Left', score: .95 }), b = hand(.51, .55, { label: 'Right', score: .95 });
    expect(assigned(pose, [a])).toEqual({ left: 0 });
    expect(assigned(pose, [a, b]).left).not.toBe(0); // 0.3.0 would have stored both and lost the left hand
    const result = gapFill({ body: pose, frameHands: [a], regionHands: { right: [{ ...b, origin: 'region' }] }, width: W, height: H });
    expect(withoutOrigin(result.hands)).toEqual([a]);
    expect(result.fills).toEqual({});
    expect(result.dropped).toEqual([{ side: 'right', label: 'Right', score: .95, reason: 'rejected-by-tracking' }]);
  });
  it('chooses one candidate per side by wrist distance, not by label or score, and says why the others were dropped', () => {
    const near = hand(.62, .545, { label: 'Right', score: .6 }), farther = hand(.64, .56, { label: 'Left', score: .99 });
    const weak = hand(.61, .55, { score: .3 }), outside = hand(.95, .2, { score: .99 }), broken = { ...hand(.6, .5), image: hand(.6, .5).image.slice(0, 20) };
    const result = gapFill({ body: body(), frameHands: [], regionHands: { left: [farther, weak, outside, broken, near] }, width: W, height: H });
    expect(result.fills).toEqual({ left: 0 });
    expect(result.hands[0].image[0]).toEqual(near.image[0]);
    expect(result.dropped.map(d => d.reason).sort()).toEqual(['far-from-wrist', 'invalid', 'low-score', 'not-best']);
    // Both crops saw one hand near two close wrists: the nearer wrist keeps it.
    const pose = body({ 15: point(.50, .55), 13: point(.50, .75), 16: point(.54, .55), 14: point(.54, .75) });
    const shared = hand(.51, .55, { label: 'Left', score: .9 });
    const split = gapFill({ body: pose, frameHands: [], regionHands: { left: [shared], right: [shared] }, width: W, height: H });
    expect(split.fills).toEqual({ left: 0 });
    expect(split.dropped).toEqual([{ side: 'right', label: 'Left', score: .9, reason: 'duplicate' }]);
  });
});

describe('re-detection orchestration', () => {
  it('adds a hand only the crop found; the unchanged wrist rule assigns it to its anatomical side', async () => {
    const pose = body(), small = hand(.62, .545, { label: 'Left', score: .88 });
    const { hands, regions } = await refineHands({ body: pose, frameHands: [], width: W, height: H, detectRegion: seeing([small]) });
    expect(regions.left).not.toBeNull();
    expect(hands).toHaveLength(1); expect(hands[0].origin).toBe('region');
    expect(hands[0].image[0].x).toBeCloseTo(.62, 9);
    expect(assigned(pose, hands)).toEqual({ left: 0 });
  });
  it('does not add a hand the wrist rule would withhold between crossing wrists', async () => {
    const pose = body({ 15: point(.5, .55), 16: point(.52, .55), 13: point(.6, .75), 14: point(.42, .75) });
    const between = hand(.51, .55, { label: 'Left', score: .9 });
    const { hands, trace } = await refineHands({ body: pose, frameHands: [], width: W, height: H, detectRegion: seeing([between]) });
    expect(hands).toEqual([]);
    expect(trace.dropped.map(d => d.reason)).toEqual(['duplicate', 'rejected-by-tracking']);
  });
  it('cuts each square from the detail frame and upscales it to the crop size', async () => {
    const drawImage = vi.fn(), context = { clearRect: vi.fn(), drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
    const surface = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const source = { width: 1400, height: 932 } as HTMLCanvasElement; // 2× the analysis frame
    const landmarker = { detect: vi.fn(() => ({ landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] })) };
    await detectWithRegions({ body: body(), frameHands: [], source, surface, landmarker, settings: HAND_REGION_DEFAULTS });
    const region = predictHandRegions(body(), 1400, 932).left!;
    expect(surface.width).toBe(HAND_REGION_DEFAULTS.cropSize);
    expect(drawImage).toHaveBeenCalledWith(source, region.x0, region.y0, region.size, region.size, 0, 0, 320, 320);
    expect(landmarker.detect).toHaveBeenCalledTimes(2);
    expect(landmarker.detect).toHaveBeenCalledWith(surface);
  });
});
