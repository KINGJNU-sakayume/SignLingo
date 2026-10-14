import { Vector3 } from 'three';
import { q, qa, solveArm, v } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { SIDES, type DisplayPose, type Quat, type Side, type Vec3 } from '../types';
import { armVisible, withPose } from './pipeline';
import { degrees, filtfiltQuaternions, filtfiltVectors, geodesicMedian, medianVector, percentile } from './quaternion';
import type { DisplayClip, DisplayFrame, DisplayStage } from './types';

export const TORSO_STAGE = 'torso-stabilize';
export type TorsoOptions = { fixedMaxDegrees?: number; fixedMaxRootMeters?: number; cutoffHz?: number };
export type TorsoReport = {
  mode: 'fixed' | 'smoothed' | 'unavailable'; spreadDegrees: number; thresholdDegrees: number;
  rootMode: 'fixed' | 'smoothed' | 'unavailable'; rootSpreadMeters: number;
  maxDeviationDegrees: number; maxWristResidual: number; maxElbowShift: number;
};
// Course 1 measurements (docs/DISPLAY_PIPELINE.md): p90 torso deviation 6.5°/4.2° for thanks/meet,
// 18.4° for sorry. Below the threshold the variation is treated as estimation noise and removed.
export const DEFAULTS = { fixedMaxDegrees: 8, fixedMaxRootMeters: .01, cutoffHz: 1 };
const shoulderOffset = (side: Side) => new Vector3(side === 'left' ? .19 : -.19, 0, 0);

/** Per-frame targets: one robust value, or a zero-phase low-pass within each segment. */
function targets<T>(frames: readonly DisplayFrame[], valid: boolean[], fixed: T | null, values: T[], smooth: (times: number[], xs: T[]) => T[]): T[] {
  if (fixed) return frames.map(() => fixed);
  const out = values.slice();
  const segments = new Map<number, number[]>();
  frames.forEach((f, i) => { if (valid[i]) segments.set(f.segment, [...segments.get(f.segment) ?? [], i]); });
  for (const indices of segments.values()) {
    const smoothed = smooth(indices.map(i => frames[i].timestamp), indices.map(i => values[i]));
    indices.forEach((i, k) => { out[i] = smoothed[k]; });
  }
  // Frames without a torso take the nearest stabilized value of their segment (their arms are hidden).
  const previous: number[] = [], next: number[] = [];
  for (let i = 0, last = -1; i < frames.length; i++) { if (valid[i]) last = i; previous[i] = last >= 0 && frames[last].segment === frames[i].segment ? last : -1; }
  for (let i = frames.length - 1, last = -1; i >= 0; i--) { if (valid[i]) last = i; next[i] = last >= 0 && frames[last].segment === frames[i].segment ? last : -1; }
  frames.forEach((_, i) => {
    if (valid[i]) return;
    const a = previous[i], b = next[i];
    const best = a < 0 ? b : b < 0 ? a : i - a <= b - i ? a : b;
    if (best >= 0) out[i] = out[best];
  });
  return out;
}

/**
 * Holds the torso (and root) still when its variation is small; otherwise removes only its
 * high-frequency part. Children keep their world orientation (upper' = q_s⁻¹·q_o·upper, the same
 * for the head). Because the shoulders sit ±0.19 m from the root, a new torso also moves them, so
 * every visible arm is re-solved from the new shoulder to the ORIGINAL wrist with the original elbow
 * as pole, and the original world palm is re-attached with the reconstruction's own roll allocation.
 * Wrist position, palm orientation and fingers are therefore unchanged; only the elbow moves.
 */
export function stabilizeTorso(options: TorsoOptions = {}): DisplayStage {
  const config = { ...DEFAULTS, ...options };
  return { id: TORSO_STAGE, run(display: DisplayClip): DisplayClip {
    const frames = display.frames, valid = frames.map(f => f.pose.quality.body > 0);
    const quats = frames.map(f => q(f.pose.rotations.torso).normalize()), roots = frames.map(f => v(f.pose.root));
    const goodQ = quats.filter((_, i) => valid[i]), goodR = roots.filter((_, i) => valid[i]);
    const report: TorsoReport = { mode: 'unavailable', spreadDegrees: 0, thresholdDegrees: config.fixedMaxDegrees, rootMode: 'unavailable', rootSpreadMeters: 0, maxDeviationDegrees: 0, maxWristResidual: 0, maxElbowShift: 0 };
    if (!goodQ.length) return { ...display, reports: { ...display.reports, [TORSO_STAGE]: report } };

    const median = geodesicMedian(goodQ);
    report.spreadDegrees = percentile(goodQ.map(x => degrees(x.angleTo(median))), .9);
    report.mode = report.spreadDegrees <= config.fixedMaxDegrees ? 'fixed' : 'smoothed';
    const rootMedian = medianVector(goodR);
    report.rootSpreadMeters = percentile(goodR.map(r => r.distanceTo(rootMedian)), .9);
    report.rootMode = report.rootSpreadMeters <= config.fixedMaxRootMeters ? 'fixed' : 'smoothed';
    const torso = targets(frames, valid, report.mode === 'fixed' ? median : null, quats, (t, xs) => filtfiltQuaternions(t, xs, config.cutoffHz));
    const root = targets(frames, valid, report.rootMode === 'fixed' ? rootMedian : null, roots, (t, xs) => filtfiltVectors(t, xs, config.cutoffHz));

    const out = frames.map((frame, i) => {
      const pose = frame.pose, qo = quats[i], qs = torso[i].clone().normalize(), rs = root[i];
      const delta = qs.clone().invert().multiply(qo);
      const rotations: Record<string, Quat> = { ...pose.rotations, torso: qa(qs), head: qa(delta.clone().multiply(q(pose.rotations.head))) };
      const next: DisplayPose = { ...pose, root: [rs.x, rs.y, rs.z] as Vec3, rotations };
      const wristResidual = { left: 0, right: 0 }, elbowShift = { left: 0, right: 0 };
      for (const side of SIDES) {
        rotations[`${side}.upper`] = qa(delta.clone().multiply(q(pose.rotations[`${side}.upper`])));
        if (!armVisible(pose, side)) continue;
        const before = forwardArm(pose, side);
        const shoulder = shoulderOffset(side).applyQuaternion(qs).add(rs);
        const arm = solveArm(shoulder, before.wrist, before.elbow);
        const { forearm, wrist } = distributeForearmRoll(arm.lowerQ, before.palm);
        rotations[`${side}.upper`] = qa(qs.clone().invert().multiply(arm.upperQ));
        rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(forearm));
        rotations[`${side}.wrist`] = qa(wrist);
        wristResidual[side] = arm.wrist.distanceTo(before.wrist); elbowShift[side] = arm.elbow.distanceTo(before.elbow);
      }
      const deviationDegrees = degrees(qo.angleTo(qs));
      report.maxDeviationDegrees = Math.max(report.maxDeviationDegrees, deviationDegrees);
      report.maxWristResidual = Math.max(report.maxWristResidual, wristResidual.left, wristResidual.right);
      report.maxElbowShift = Math.max(report.maxElbowShift, elbowShift.left, elbowShift.right);
      return withPose(frame, next, TORSO_STAGE, { torso: { mode: report.mode as 'fixed' | 'smoothed', deviationDegrees, wristResidual, elbowShift } });
    });
    return { ...display, frames: out, reports: { ...display.reports, [TORSO_STAGE]: report } };
  } };
}
