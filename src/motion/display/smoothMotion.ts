import { Quaternion, Vector3 } from 'three';
import { q, qa, solveArm } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { handState } from '../constraints/points';
import { SIDES, type DisplayPose, type Quat, type Side } from '../types';
import { armVisible, withPose } from './pipeline';
import type { DisplayClip, DisplayFrame, DisplayStage } from './types';

export const SMOOTH_STAGE = 'smooth-motion';
/**
 * One Euro filter (Casiez et al., CHI 2012) parameters: the cutoff is `minCutoffHz` while a value is still and rises
 * by `beta` per unit of speed, so frame-to-frame tracking jitter in a hold is removed while a fast tap keeps its
 * amplitude. Speeds are m/s for positions and rad/s for rotations.
 */
export type SmoothOptions = { minCutoffHz?: number; beta?: number; rotationBeta?: number; derivativeCutoffHz?: number };
// Tuned on course 1: hold jitter about -40% (ksl-thanks r5 0.78 → 0.45 cm per frame) while the two taps of ksl-thanks r4
// keep their touches (≤1.6 cm) and most of the lift between them (9.5 → 8.1 cm).
export const SMOOTH_DEFAULTS = { minCutoffHz: 1.2, beta: 30, rotationBeta: .6, derivativeCutoffHz: 4 };
export type SmoothReport = {
  /** Frames whose arm, hand or head was filtered, per side. */
  frames: Record<Side, number>;
  /** Largest wrist move made by the filter (m) and frame-to-frame wrist motion (RMS, m) before and after, per side. */
  maxWristShift: Record<Side, number>; wristStep: Record<Side, { before: number; after: number }>;
};

const alpha = (dt: number, cutoff: number) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / Math.max(dt, 1e-6)); };
type Ops<T> = { lerp: (a: T, b: T, t: number) => T; speed: (a: T, b: T, dt: number) => number };
const VECTOR: Ops<Vector3> = { lerp: (a, b, t) => a.clone().lerp(b, t), speed: (a, b, dt) => a.distanceTo(b) / Math.max(dt, 1e-6) };
const QUAT: Ops<Quaternion> = { lerp: (a, b, t) => a.clone().slerp(b, t).normalize(), speed: (a, b, dt) => a.angleTo(b) / Math.max(dt, 1e-6) };

function oneEuro<T>(times: number[], xs: T[], ops: Ops<T>, minCutoff: number, beta: number, dCutoff: number): T[] {
  const out = [xs[0]];
  let speed = 0;
  for (let i = 1; i < xs.length; i++) {
    const dt = times[i] - times[i - 1];
    speed += alpha(dt, dCutoff) * (ops.speed(out[i - 1], xs[i], dt) - speed);
    out.push(ops.lerp(out[i - 1], xs[i], alpha(dt, minCutoff + beta * speed)));
  }
  return out;
}
/** Forward then backward over the forward result: the two lags cancel, so the filter adds no delay. */
function zeroPhase<T>(times: number[], xs: T[], ops: Ops<T>, minCutoff: number, beta: number, dCutoff: number): T[] {
  if (xs.length < 3) return xs;
  const forward = oneEuro(times, xs, ops, minCutoff, beta, dCutoff);
  const end = times.at(-1)!;
  return oneEuro(times.map(t => end - t).reverse(), forward.slice().reverse(), ops, minCutoff, beta, dCutoff).reverse();
}

/** Consecutive frames of one segment that satisfy `keep`, as index runs of at least three frames. */
function runs(frames: readonly DisplayFrame[], keep: (frame: DisplayFrame) => boolean): number[][] {
  const out: number[][] = [];
  let run: number[] = [];
  frames.forEach((frame, i) => {
    if (keep(frame) && (!run.length || frames[run.at(-1)!].segment === frame.segment)) run.push(i);
    else { if (run.length >= 3) out.push(run); run = keep(frame) ? [i] : []; }
  });
  if (run.length >= 3) out.push(run);
  return out;
}

/**
 * Removes frame-to-frame tracking jitter from what the learner sees (display only; stored motion, Practice and
 * reviews use the original values). Per hand, over runs of frames where the arm is shown and the hand is not missing,
 * the world wrist position, elbow, palm orientation and finger rotations are filtered with a zero-phase One Euro
 * filter; the arm is then re-solved from the (already stabilized) shoulder to the filtered wrist with the filtered
 * elbow as pole, and the filtered palm is re-attached with the reconstruction's roll allocation. The head rotation is
 * filtered the same way. Both hands of a held contact move alike, so the contact is kept; the hand-contact stage
 * still resolves any overlap afterwards.
 */
export function smoothMotion(options: SmoothOptions = {}): DisplayStage {
  const config = { ...SMOOTH_DEFAULTS, ...options };
  return { id: SMOOTH_STAGE, run(display: DisplayClip): DisplayClip {
    const frames = display.frames;
    const poses: DisplayPose[] = frames.map(f => ({ ...f.pose, rotations: { ...f.pose.rotations } }));
    const touched = new Set<number>();
    const report: SmoothReport = { frames: { left: 0, right: 0 }, maxWristShift: { left: 0, right: 0 }, wristStep: { left: { before: 0, after: 0 }, right: { before: 0, after: 0 } } };
    const times = frames.map(f => f.timestamp / 1000);

    for (const side of SIDES) {
      let steps = 0, before = 0, after = 0;
      for (const run of runs(frames, f => armVisible(f.pose, side) && f.annotation.hands[side].state !== 'missing')) {
        const t = run.map(i => times[i]);
        const arms = run.map(i => forwardArm(frames[i].pose, side)), hands = run.map(i => handState(frames[i].pose, side));
        const wrists = zeroPhase(t, arms.map(a => a.wrist), VECTOR, config.minCutoffHz, config.beta, config.derivativeCutoffHz);
        const elbows = zeroPhase(t, arms.map(a => a.elbow), VECTOR, config.minCutoffHz, config.beta, config.derivativeCutoffHz);
        const palms = zeroPhase(t, hands.map(h => h.palm), QUAT, config.minCutoffHz, config.rotationBeta, config.derivativeCutoffHz);
        const fingerKeys = Object.keys(frames[run[0]].pose.rotations).filter(key => key.startsWith(`${side}.`) && key.split('.').length === 3);
        const fingers = Object.fromEntries(fingerKeys.map(key => [key, zeroPhase(t, run.map(i => q(frames[i].pose.rotations[key]).normalize()), QUAT, config.minCutoffHz, config.rotationBeta, config.derivativeCutoffHz)]));
        run.forEach((i, k) => {
          const pose = poses[i], torso = q(pose.rotations.torso).normalize();
          const arm = solveArm(arms[k].shoulder, wrists[k], elbows[k]);
          const { forearm, wrist } = distributeForearmRoll(arm.lowerQ, palms[k]);
          pose.rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(arm.upperQ));
          pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(forearm));
          pose.rotations[`${side}.wrist`] = qa(wrist);
          for (const key of fingerKeys) pose.rotations[key] = qa(fingers[key][k]) as Quat;
          report.maxWristShift[side] = Math.max(report.maxWristShift[side], arm.wrist.distanceTo(arms[k].wrist));
          if (k) { before += arms[k].wrist.distanceToSquared(arms[k - 1].wrist); after += wrists[k].distanceToSquared(wrists[k - 1]); steps++; }
          touched.add(i); report.frames[side]++;
        });
      }
      report.wristStep[side] = { before: steps ? Math.sqrt(before / steps) : 0, after: steps ? Math.sqrt(after / steps) : 0 };
    }
    for (const run of runs(frames, f => f.pose.quality.body > 0)) {
      const heads = zeroPhase(run.map(i => times[i]), run.map(i => q(frames[i].pose.rotations.head).normalize()), QUAT, config.minCutoffHz, config.rotationBeta, config.derivativeCutoffHz);
      run.forEach((i, k) => { poses[i].rotations.head = qa(heads[k]); touched.add(i); });
    }
    const out = frames.map((frame, i) => touched.has(i) ? withPose(frame, poses[i], SMOOTH_STAGE) : frame);
    return { ...display, frames: out, reports: { ...display.reports, [SMOOTH_STAGE]: report } };
  } };
}
