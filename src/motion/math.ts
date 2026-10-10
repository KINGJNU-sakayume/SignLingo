import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Landmark, Quat, Vec3, Correction } from './types';
export const v = (a: Vec3) => new Vector3(...a);
export const q = (a: Quat) => new Quaternion(...a);
export const arr = (a: Vector3): Vec3 => [a.x, a.y, a.z];
export const qa = (a: Quaternion): Quat => [a.x, a.y, a.z, a.w];
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const rad = (d: number) => d * Math.PI / 180;
export const valid = (p: Landmark | undefined): p is Landmark => !!p && [p.x, p.y, p.z].every(Number.isFinite);
export const confidence = (p: Landmark | undefined) => valid(p) ? Math.min(p.visibility ?? 1, p.presence ?? 1) : 0;
export const cameraToAvatar = (p: Landmark) => new Vector3(p.x, -p.y, -p.z);
export const unmirrorImage = (p: Landmark): Landmark => ({ ...p, x: 1 - p.x });
export function normalizeBody(points: Landmark[]) {
  if (![11, 12].every(i => valid(points[i]))) return null;
  const left = cameraToAvatar(points[11]), right = cameraToAvatar(points[12]);
  const width = left.distanceTo(right);
  if (width < 0.08 || width > 1.2) return null;
  const center = left.clone().add(right).multiplyScalar(0.5);
  const scale = 0.38 / width;
  return { scale, center, points: points.map(p => valid(p) ? cameraToAvatar(p).sub(center).multiplyScalar(scale).add(new Vector3(0, 1.3, 0)) : null) };
}
// Translation between origins is explicit; orientation remains in shared camera axes.
export function alignHand(points: Landmark[], wrist: Vector3, scale = 1) {
  if (points.length !== 21 || !points.every(valid)) return null;
  const origin = cameraToAvatar(points[0]);
  return points.map(p => cameraToAvatar(p).sub(origin).multiplyScalar(scale).add(wrist));
}
export function basisQuaternion(yInput: Vector3, xInput: Vector3) {
  const y = yInput.clone().normalize();
  const z = xInput.clone().cross(y).normalize();
  if (y.lengthSq() < 0.5 || z.lengthSq() < 0.5) return null;
  const x = y.clone().cross(z).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
export function boneQuaternion(direction: Vector3, normal: Vector3) {
  const y = direction.clone().normalize();
  let z = normal.clone().addScaledVector(y, -normal.dot(y)).normalize();
  if (z.lengthSq() < 0.5) z = new Vector3(0, 0, 1).addScaledVector(y, -y.z).normalize();
  if (z.lengthSq() < 0.5) z = new Vector3(1, 0, 0);
  return basisQuaternion(y, y.clone().cross(z))!;
}
export const LENGTHS = { upper: 0.28, lower: 0.26 };
export function solveArm(shoulder: Vector3, target: Vector3, measuredElbow: Vector3, previousPole?: Vector3) {
  const { upper: a, lower: b } = LENGTHS;
  let direction = target.clone().sub(shoulder);
  const requested = direction.length();
  if (requested < 1e-6) direction = new Vector3(0, -1, 0); else direction.normalize();
  // Flexion 5..150 degrees; never permit hyperextension.
  const min = Math.sqrt(a*a+b*b+2*a*b*Math.cos(rad(150)));
  const max = Math.sqrt(a*a+b*b+2*a*b*Math.cos(rad(5)));
  const distance = clamp(requested, min, max);
  const wrist = shoulder.clone().addScaledVector(direction, distance);
  let pole = measuredElbow.clone().sub(shoulder);
  pole.addScaledVector(direction, -pole.dot(direction));
  const unstable = pole.length() < 0.025;
  if (unstable) {
    pole = (previousPole ?? new Vector3(0, -1, -0.4)).clone();
    pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-8) pole = new Vector3(1, 0, 0).cross(direction);
  }
  pole.normalize();
  const along = (a*a - b*b + distance*distance)/(2*distance);
  const height = Math.sqrt(Math.max(0, a*a-along*along));
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, height);
  const upper = elbow.clone().sub(shoulder), lower = wrist.clone().sub(elbow);
  const normal = upper.clone().cross(lower).normalize();
  const upperQ = boneQuaternion(upper, normal), lowerQ = boneQuaternion(lower, normal);
  return { elbow, wrist, pole, upperQ, lowerQ, flexion: Math.PI - Math.acos(clamp((a*a+b*b-distance*distance)/(2*a*b), -1, 1)), correction: Math.abs(distance-requested), unstable };
}
export function boundWrist(input: Quaternion) {
  const n = input.clone().normalize();
  // Swing/twist avoids Euler singularities. Twist belongs around the forearm +Y axis.
  let twist = new Quaternion(0, n.y, 0, n.w);
  if (twist.lengthSq() < 1e-10) twist.identity(); else twist.normalize();
  const swing = n.clone().multiply(twist.clone().invert());
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
  const angle = 2 * Math.acos(clamp(swing.w, -1, 1));
  if (angle > rad(85)) swing.slerp(new Quaternion(), 1-rad(85)/angle);
  let twistAngle = 2*Math.atan2(twist.y, twist.w);
  twistAngle = Math.atan2(Math.sin(twistAngle), Math.cos(twistAngle));
  const boundedTwist = clamp(twistAngle, rad(-160), rad(160));
  twist.setFromAxisAngle(new Vector3(0, 1, 0), boundedTwist);
  const result = swing.multiply(twist).normalize();
  return { rotation: result, correction: n.angleTo(result), swing: Math.min(angle, rad(85)), twist: boundedTwist };
}
export function constrainedAngle(value: number, min: number, max: number, joint: string, corrections: Correction[]) {
  const result = clamp(value, rad(min), rad(max));
  if (Math.abs(result - value) > rad(2)) corrections.push({ joint, kind: 'angular-limit-radians', amount: Math.abs(result-value) });
  return result;
}
export const eulerQuat = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'));
