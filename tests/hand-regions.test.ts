// Pipeline 0.3.0 hand-region geometry and fusion. Synthetic landmarks only; no MediaPipe, no signer.
import { describe, expect, it, vi } from 'vitest';
import { fuseHands, HAND_REGION_DEFAULTS, handSeparation, predictHandRegions, refineHands, toFrameHand, type HandRegion } from '../src/motion/handRegions';
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

describe('confidence fusion', () => {
  it('keeps the higher-scoring estimate of the same hand and prefers the full frame on a tie', () => {
    const frame = hand(.5, .5, { score: .8 }), region = { ...hand(.501, .501, { score: .93 }), origin: 'region' as const };
    expect(fuseHands([frame], [region], W, H)).toEqual([region]);
    const tie = fuseHands([frame], [{ ...region, score: .8 }], W, H);
    expect(tie).toHaveLength(1); expect(tie[0].origin).toBe('frame'); expect(tie[0].image).toEqual(frame.image);
  });
  it('keeps two touching hands whose boxes overlap but whose landmarks do not correspond', () => {
    const left = hand(.5, .5, { label: 'Left' }), right = hand(.53, .47, { label: 'Right', direction: Math.PI, score: .7 });
    expect(handSeparation(left, right, W, H)).toBeGreaterThan(HAND_REGION_DEFAULTS.fusion.sameHand);
    expect(fuseHands([left], [right], W, H).map(h => h.label)).toEqual(['Left', 'Right']);
  });
  it('requires closer agreement before merging estimates with opposite handedness labels', () => {
    const a = hand(.5, .5, { label: 'Left', score: .9 }), b = hand(.5 + .005 * H / W, .505, { label: 'Right', score: .6 });
    const separation = handSeparation(a, b, W, H);
    expect(separation).toBeGreaterThan(HAND_REGION_DEFAULTS.fusion.sameHandOppositeLabel);
    expect(separation).toBeLessThan(HAND_REGION_DEFAULTS.fusion.sameHand);
    expect(fuseHands([a], [b], W, H)).toHaveLength(2);
    expect(fuseHands([a], [{ ...b, label: 'Left' }], W, H)).toHaveLength(1);
  });
  it('merges both regions seeing the same hand, keeps at most two hands by score and drops malformed ones', () => {
    const seen = [hand(.5, .5, { score: .7 }), hand(.5005, .5, { score: .75 })];
    expect(fuseHands([], seen, W, H)).toHaveLength(1);
    const three = [hand(.2, .5, { score: .6 }), hand(.5, .5, { score: .9 }), hand(.8, .5, { score: .7 })];
    expect(fuseHands(three, [], W, H).map(h => h.score)).toEqual([.9, .7]);
    const broken = { ...hand(.3, .3, { score: .99 }), image: hand(.3, .3).image.slice(0, 20) };
    const nan = { ...hand(.6, .3, { score: .98 }), world: hand(.6, .3).world.map((p, i) => i ? p : { ...p, x: NaN }) };
    expect(fuseHands([broken], [nan], W, H)).toEqual([]);
  });
});

describe('re-detection orchestration', () => {
  /** A fake crop detector that sees `inFrame` hands through the given region, in crop coordinates. */
  const seeing = (inFrame: HandDetection[]) => (region: HandRegion) => inFrame
    .filter(h => h.image[0].x * W > region.x0 && h.image[0].x * W < region.x0 + region.size && h.image[0].y * H > region.y0 && h.image[0].y * H < region.y0 + region.size)
    .map(h => ({ ...h, image: h.image.map(p => ({ ...p, x: (p.x * W - region.x0) / region.size, y: (p.y * H - region.y0) / region.size, z: p.z * W / region.size })) }));
  it('adds a hand only the crop found; the unchanged wrist rule assigns it to its anatomical side', async () => {
    const pose = body(), small = hand(.62, .545, { label: 'Left', score: .88 });
    const { hands, regions } = await refineHands({ body: pose, frameHands: [], width: W, height: H, detectRegion: seeing([small]) });
    expect(regions.left).not.toBeNull();
    expect(hands).toHaveLength(1); expect(hands[0].origin).toBe('region');
    expect(hands[0].image[0].x).toBeCloseTo(.62, 9);
    const { assignment } = assignHands({ timestamp: 0, body: pose, bodyWorld: pose, hands });
    expect(assignment).toEqual({ left: 0 });
  });
  it('still withholds a hand between crossing wrists', async () => {
    const pose = body({ 15: point(.5, .55), 16: point(.52, .55), 13: point(.6, .75), 14: point(.42, .75) });
    const between = hand(.51, .55, { label: 'Left', score: .9 });
    const { hands } = await refineHands({ body: pose, frameHands: [], width: W, height: H, detectRegion: seeing([between]) });
    expect(hands).toHaveLength(1); // both crops saw it: one hand after fusion
    const result = assignHands({ timestamp: 0, body: pose, bodyWorld: pose, hands });
    expect(result.assignment).toEqual({});
    expect(result.warnings.some(w => w.startsWith('Ambiguous hand identity'))).toBe(true);
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
