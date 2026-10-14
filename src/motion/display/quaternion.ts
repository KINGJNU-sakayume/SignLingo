import { Quaternion, Vector3 } from 'three';

export const degrees = (radians: number) => radians * 180 / Math.PI;

/** Rotation vector (axis × angle) of a unit quaternion, on the shortest arc. */
export function logQuaternion(input: Quaternion): Vector3 {
  const q = input.w < 0 ? new Quaternion(-input.x, -input.y, -input.z, -input.w) : input;
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-12) return new Vector3();
  const angle = 2 * Math.atan2(s, q.w);
  return new Vector3(q.x, q.y, q.z).multiplyScalar(angle / s);
}
export function expQuaternion(v: Vector3): Quaternion {
  const angle = v.length();
  if (angle < 1e-12) return new Quaternion();
  return new Quaternion().setFromAxisAngle(v.clone().divideScalar(angle), angle);
}
function chordalMean(qs: Quaternion[]): Quaternion {
  const sum = new Quaternion(0, 0, 0, 0), first = qs[0];
  for (const q of qs) {
    const sign = q.dot(first) < 0 ? -1 : 1;
    sum.set(sum.x + sign * q.x, sum.y + sign * q.y, sum.z + sign * q.z, sum.w + sign * q.w);
  }
  return sum.lengthSq() > 1e-12 ? sum.normalize() : first.clone();
}
/** Geodesic (L1) median by Weiszfeld iteration: robust to a minority of outlying orientations. */
export function geodesicMedian(qs: Quaternion[], iterations = 50): Quaternion {
  let median = chordalMean(qs);
  for (let k = 0; k < iterations; k++) {
    const step = new Vector3(); let weight = 0;
    const inverse = median.clone().invert();
    for (const q of qs) {
      const v = logQuaternion(inverse.clone().multiply(q)), d = v.length();
      const w = 1 / Math.max(d, 1e-6);
      step.addScaledVector(v, w); weight += w;
    }
    step.divideScalar(weight);
    median = median.clone().multiply(expQuaternion(step)).normalize();
    if (step.length() < 1e-10) break;
  }
  return median;
}
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
export function medianVector(vs: Vector3[]): Vector3 {
  return new Vector3(percentile(vs.map(v => v.x), .5), percentile(vs.map(v => v.y), .5), percentile(vs.map(v => v.z), .5));
}
const alpha = (dtMs: number, cutoffHz: number) => 1 - Math.exp(-2 * Math.PI * cutoffHz * Math.max(0, dtMs) / 1000);
/**
 * Zero-phase first-order low-pass: a causal pass, then an anti-causal pass over its output.
 * The two opposite lags cancel, so a slow lean is not delayed relative to the hands.
 */
export function filtfiltQuaternions(times: number[], qs: Quaternion[], cutoffHz: number): Quaternion[] {
  if (qs.length < 2) return qs.map(q => q.clone());
  const forward = [qs[0].clone()];
  for (let i = 1; i < qs.length; i++) forward.push(forward[i - 1].clone().slerp(qs[i], alpha(times[i] - times[i - 1], cutoffHz)).normalize());
  const backward = forward.map(q => q.clone());
  for (let i = qs.length - 2; i >= 0; i--) backward[i] = backward[i + 1].clone().slerp(forward[i], alpha(times[i + 1] - times[i], cutoffHz)).normalize();
  return backward;
}
export function filtfiltVectors(times: number[], vs: Vector3[], cutoffHz: number): Vector3[] {
  if (vs.length < 2) return vs.map(v => v.clone());
  const forward = [vs[0].clone()];
  for (let i = 1; i < vs.length; i++) forward.push(forward[i - 1].clone().lerp(vs[i], alpha(times[i] - times[i - 1], cutoffHz)));
  const backward = forward.map(v => v.clone());
  for (let i = vs.length - 2; i >= 0; i--) backward[i] = backward[i + 1].clone().lerp(forward[i], alpha(times[i + 1] - times[i], cutoffHz));
  return backward;
}
