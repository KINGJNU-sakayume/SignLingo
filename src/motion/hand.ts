import { Quaternion, Vector3 } from 'three';
import { basisQuaternion, eulerQuat, qa, rad } from './math';
import { FINGERS, type Quat, type Side } from './types';

export function palmFrame(points: Vector3[], side: Side) {
  const longitudinal = points[9].clone().sub(points[0]);
  const radial = points[5].clone().sub(points[17]).multiplyScalar(side === 'left' ? -1 : 1);
  // Check conditioning BEFORE normalization; an almost collinear palm has an arbitrary normal.
  const area = longitudinal.clone().cross(radial).length();
  const conditioning = area / Math.max(1e-12, longitudinal.length() * radial.length());
  if (longitudinal.length() < .015 || radial.length() < .015 || conditioning < .2) return null;
  const rotation = basisQuaternion(longitudinal, radial);
  return rotation ? { rotation, conditioning } : null;
}

export function reconstructFingers(points: Vector3[], palm: Quaternion, side: Side) {
  const rotations: Record<string, Quat> = {};
  const warnings: string[] = [];
  for (let f = 0; f < FINGERS.length; f++) {
    const finger = FINGERS[f], start = 1 + f * 4;
    // Always accumulate the EXACT rotations emitted to the renderer. Minimal-swing
    // replacement frames have a different axial roll and cannot be used as parents.
    const parent = palm.clone();
    for (let j = 0; j < 3; j++) {
      const key = `${side}.${finger}.${j}`;
      const direction = points[start+j+1].clone().sub(points[start+j]);
      if (direction.length() < .003 || direction.length() > .10) return null;
      const local = direction.normalize().applyQuaternion(parent.clone().invert());
      // Rx(flex) Rz(spread) maps +Y to (-sin(spread), cos(spread)cos(flex),
      // cos(spread)sin(flex)). These inverse angles reproduce the observed vector.
      const flex = Math.atan2(local.z, local.y);
      const spread = -Math.atan2(local.x, Math.hypot(local.y, local.z));
      const rotation = eulerQuat(flex, 0, spread);
      rotations[key] = qa(rotation);
      parent.multiply(rotation).normalize();
      // Broad limits are inspection flags, not evidence to overwrite a sign.
      // Thumb CMC uses two observed swing DOFs for opposition; axial twist is unobservable.
      const flexMin = f === 0 ? -60 : j === 0 ? -35 : -20;
      const flexMax = f === 0 ? 130 : j === 0 ? 115 : 140;
      const spreadMax = f === 0 ? (j === 0 ? 90 : 35) : (j === 0 ? 45 : 20);
      if (flex < rad(flexMin) || flex > rad(flexMax) || Math.abs(spread) > rad(spreadMax)) {
        warnings.push(`${key}: unusual estimated articulation; preserved for inspection.`);
      }
    }
  }
  return { rotations, warnings };
}

// Allocation, not an independent measurement of radius/ulna rotation. The product
// lower * wrist remains exactly the detected palm orientation, including legitimate flips.
export function distributeForearmRoll(lower: Quaternion, palm: Quaternion) {
  const relative = lower.clone().invert().multiply(palm);
  const roll = new Quaternion(0, relative.y, 0, relative.w);
  if (roll.lengthSq() < 1e-10) roll.identity(); else roll.normalize();
  const forearm = lower.clone().multiply(roll);
  const wrist = forearm.clone().invert().multiply(palm).normalize();
  const swing = new Vector3(0, 1, 0).angleTo(new Vector3(0, 1, 0).applyQuaternion(wrist));
  return { forearm, wrist, swing };
}
