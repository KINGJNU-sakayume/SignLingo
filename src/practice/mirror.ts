import type { HandDetection, Landmark, MotionClip, MotionFrame } from '../motion/types';

// MediaPipe Pose left/right landmark pairs (eyes, ears, mouth corners, shoulders, arms, hands, hips, legs, feet).
const PAIRS: [number, number][] = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const SWAP = (() => { const m = Array.from({ length: 33 }, (_, i) => i); for (const [a, b] of PAIRS) { m[a] = b; m[b] = a; } return m; })();
const flipImage = (p: Landmark): Landmark => ({ ...p, x: 1 - p.x });
const flipWorld = (p: Landmark): Landmark => ({ ...p, x: -p.x });

/**
 * The same attempt as if signed with the other hand: body landmark pairs swapped and every landmark reflected
 * left-right (image x → 1 − x, world x → −x), hands reflected with their handedness label and side assignment
 * swapped. Used only to test whether an attempt is mirrored; never shown or stored.
 */
export function mirrorClip(clip: MotionClip): MotionClip {
  const hand = (h: HandDetection): HandDetection => ({ ...h, label: h.label === 'Left' ? 'Right' : h.label === 'Right' ? 'Left' : h.label, image: h.image.map(flipImage), world: h.world.map(flipWorld) });
  const frames = clip.frames.map((f): MotionFrame => ({
    ...f,
    body: f.body.length ? SWAP.map(i => flipImage(f.body[i])).slice(0, f.body.length) : f.body,
    bodyWorld: f.bodyWorld.length ? SWAP.map(i => flipWorld(f.bodyWorld[i])).slice(0, f.bodyWorld.length) : f.bodyWorld,
    hands: f.hands.map(hand),
    assignment: { ...(f.assignment.right !== undefined ? { left: f.assignment.right } : {}), ...(f.assignment.left !== undefined ? { right: f.assignment.left } : {}) },
  }));
  return { ...clip, frames };
}
