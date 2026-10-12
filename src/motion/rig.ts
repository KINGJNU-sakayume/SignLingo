import { Vector3 } from 'three';
import { FINGERS, SIDES, type Pose, type Quat, type Side } from './types';
import { eulerQuat, LENGTHS, q, qa, rad, v } from './math';

export const fingerLengths: Record<string, number[]> = {
  thumb: [0.035, 0.027, 0.024], index: [0.038, 0.025, 0.020],
  middle: [0.042, 0.028, 0.022], ring: [0.039, 0.026, 0.020], pinky: [0.030, 0.020, 0.018],
};
export const fingerOffsets: Record<string, [number, number, number]> = {
  thumb: [-0.027, 0.022, 0.008], index: [-0.027, 0.075, 0], middle: [-0.008, 0.081, 0], ring: [0.012, 0.075, 0], pinky: [0.029, 0.062, 0],
};
export function neutralRotations(): Record<string, Quat> {
  const out: Record<string, Quat> = { torso: [0,0,0,1], head: [0,0,0,1] };
  for (const side of SIDES) {
    out[`${side}.upper`] = qa(eulerQuat(0,0,side==='left' ? rad(165) : rad(-165)));
    out[`${side}.lower`] = [0,0,0,1]; out[`${side}.wrist`] = [0,0,0,1];
    for (const finger of FINGERS) for (let j=0;j<3;j++) out[`${side}.${finger}.${j}`] = [0,0,0,1];
  }
  return out;
}

// This is the same +Y bone hierarchy used by Avatar.tsx, including thumb CMC/MCP/IP.
export function forwardArm(pose: Pose, side: Side) {
  const torso = q(pose.rotations.torso);
  const shoulder = new Vector3(side === 'left' ? .19 : -.19, 0, 0).applyQuaternion(torso).add(v(pose.root));
  const upper = torso.clone().multiply(q(pose.rotations[`${side}.upper`]));
  const elbow = new Vector3(0, LENGTHS.upper, 0).applyQuaternion(upper).add(shoulder);
  const lower = upper.clone().multiply(q(pose.rotations[`${side}.lower`]));
  const wrist = new Vector3(0, LENGTHS.lower, 0).applyQuaternion(lower).add(elbow);
  const palm = lower.clone().multiply(q(pose.rotations[`${side}.wrist`]));
  return { shoulder, elbow, wrist, upper, lower, palm };
}
export function forwardHand(pose: Pose, side: Side) {
  const arm = forwardArm(pose, side);
  const points = [arm.wrist.clone()];
  const segments: { joint: string; start: Vector3; end: Vector3; direction: Vector3 }[] = [];
  for (const finger of FINGERS) {
    const offset = new Vector3(...fingerOffsets[finger]);
    if (side === 'right') offset.x *= -1;
    let position = offset.applyQuaternion(arm.palm).add(arm.wrist);
    let orientation = arm.palm.clone();
    points.push(position.clone());
    for (let j = 0; j < 3; j++) {
      const joint = `${side}.${finger}.${j}`;
      orientation.multiply(q(pose.rotations[joint]));
      const direction = new Vector3(0, 1, 0).applyQuaternion(orientation).normalize();
      const end = position.clone().addScaledVector(direction, fingerLengths[finger][j]);
      segments.push({ joint, start: position, end, direction });
      position = end;
      points.push(position.clone());
    }
  }
  return { ...arm, points, segments };
}
