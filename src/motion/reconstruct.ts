import { Quaternion, Vector3 } from 'three';
import type { Detection, MotionFrame, Quat, Side } from './types';
import { FINGERS, SIDES } from './types';
import { alignHand, basisQuaternion, boundWrist, clamp, confidence, constrainedAngle, eulerQuat, LENGTHS, normalizeBody, q, qa, rad, solveArm } from './math';
import { assignHands } from './tracking';

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
export class Reconstructor {
  private previous?: MotionFrame;
  private lastGood: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private poles: Partial<Record<Side, Vector3>> = {};
  reconstruct(frame: Detection): MotionFrame {
    const { assignment, warnings } = assignHands(frame);
    const result: MotionFrame = { ...frame, assignment, warnings, corrections: [], pose: { root: [0,1.3,0], rotations: neutralRotations(), quality: { body: 0, left: 0, right: 0, leftArm: 0, rightArm: 0, leftState: 'missing', rightState: 'missing' } } };
    const normalized = normalizeBody(frame.bodyWorld);
    const bodyScore = Math.min(...[11,12].map(i => Math.min(confidence(frame.body[i]), confidence(frame.bodyWorld[i]))));
    const dt = this.previous ? Math.max(0.001, (frame.timestamp-this.previous.timestamp)/1000) : 1/30;
    if (!normalized || bodyScore < 0.45) {
      result.warnings.push('Torso tracking unavailable; reconstruction withheld.');
      this.previous = result;
      return result;
    }
    result.pose.quality.body = bodyScore;
    const points = normalized.points;
    const x = points[11]!.clone().sub(points[12]!);
    const hipsValid = [23,24].every(i => points[i] && confidence(frame.body[i]) > 0.5);
    const up = hipsValid ? new Vector3(0,1.3,0).sub(points[23]!.clone().add(points[24]!).multiplyScalar(0.5)) : new Vector3(0,1,0);
    const torso = basisQuaternion(up, x) ?? new Quaternion();
    result.pose.rotations.torso = qa(torso);
    if (points[0] && points[7] && points[8] && [0,7,8].every(i => confidence(frame.body[i]) > 0.5)) {
      const earCenter = points[7]!.clone().add(points[8]!).multiplyScalar(0.5);
      const faceDir = points[0]!.clone().sub(earCenter).applyQuaternion(torso.clone().invert()).normalize();
      const yaw = clamp(Math.atan2(faceDir.x, Math.max(0.05, faceDir.z)), rad(-65), rad(65));
      const pitch = clamp(-Math.atan2(faceDir.y, Math.hypot(faceDir.x, faceDir.z)), rad(-35), rad(35));
      result.pose.rotations.head = qa(eulerQuat(pitch,yaw,0));
    } else result.warnings.push('Head orientation unavailable; neutral head displayed.');
    for (const side of SIDES) {
      const indices = side === 'left' ? [11,13,15] : [12,14,16];
      const reliability = Math.min(...indices.map(i=>Math.min(confidence(frame.body[i]), confidence(frame.bodyWorld[i]))));
      const sgn = side === 'left' ? 1 : -1;
      const shoulder = new Vector3(sgn*0.19,0,0).applyQuaternion(torso).add(new Vector3(0,1.3,0));
      const handIndex = assignment[side];
      const hand = handIndex === undefined ? undefined : frame.hands[handIndex];
      if (reliability < 0.45 || !indices.every(i=>points[i])) {
        result.warnings.push(`${side}: arm landmarks unreliable.`);
        continue;
      }
      result.pose.quality[`${side}Arm`] = reliability;
      const target = points[indices[2]]!.clone();
      // A broad shoulder cone flags extreme elevation without a sign-specific pose prior.
      const localTarget = target.clone().sub(shoulder).applyQuaternion(torso.clone().invert());
      const angle = localTarget.angleTo(new Vector3(0,-1,0));
      if (angle > rad(170)) {
        const axis = new Vector3(0,-1,0).cross(localTarget).normalize();
        localTarget.copy(new Vector3(0,-localTarget.length(),0).applyAxisAngle(axis.lengthSq()>0.1 ? axis : new Vector3(0,0,1),rad(170)));
        target.copy(localTarget.applyQuaternion(torso).add(shoulder));
        result.corrections.push({ joint: `${side}.shoulder`, kind: 'elevation-cone-radians', amount: angle-rad(170) });
      }
      const arm = solveArm(shoulder,target,points[indices[1]]!,this.poles[side]);
      const upperLocal=arm.elbow.clone().sub(shoulder).normalize().applyQuaternion(torso.clone().invert());
      const upperElevation=upperLocal.angleTo(new Vector3(0,-1,0));
      if(upperElevation>rad(170)){
        let axis=new Vector3(0,-1,0).cross(upperLocal).normalize();
        if(axis.lengthSq()<0.1)axis=new Vector3(0,0,1);
        const bounded=new Vector3(0,-1,0).applyAxisAngle(axis,rad(170)).applyQuaternion(torso);
        const correction=new Quaternion().setFromUnitVectors(upperLocal.applyQuaternion(torso),bounded);
        arm.upperQ.premultiply(correction);arm.lowerQ.premultiply(correction);
        arm.elbow.copy(shoulder).addScaledVector(bounded,LENGTHS.upper);
        arm.wrist.copy(new Vector3(0,LENGTHS.lower,0).applyQuaternion(arm.lowerQ).add(arm.elbow));
        result.corrections.push({joint:`${side}.shoulder`,kind:'upper-arm-elevation-radians',amount:upperElevation-rad(170)});
      }
      if (this.poles[side] && this.poles[side]!.dot(arm.pole) < -0.7) result.warnings.push(`${side}: suspected elbow-plane flip.`);
      this.poles[side] = arm.pole;
      if (arm.correction > 0.01) result.corrections.push({ joint: `${side}.elbow`, kind: 'reach-clamp-meters', amount: arm.correction });
      if (arm.unstable) result.warnings.push(`${side}: elbow plane underdetermined; retained bend direction.`);
      result.pose.rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(arm.upperQ));
      result.pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(arm.lowerQ));
      result.pose.quality[side] = 0;
      if (hand) {
        const hp = alignHand(hand.world,arm.wrist)!;
        const palm = basisQuaternion(hp[9].clone().sub(hp[0]), hp[5].clone().sub(hp[17]).multiplyScalar(-sgn));
        if (palm) {
          const wrist = boundWrist(arm.lowerQ.clone().invert().multiply(palm));
          result.pose.rotations[`${side}.wrist`] = qa(wrist.rotation);
          if (wrist.correction > rad(2)) result.corrections.push({ joint: `${side}.wrist`, kind: 'swing-twist-radians', amount: wrist.correction });
          const palmInv = palm.clone().invert();
          for (let f=0;f<5;f++) {
            const finger = FINGERS[f];
            const start = f===0 ? 1 : 5+(f-1)*4;
            let parentWorld = palm.clone();
            for (let j=0;j<3;j++) {
              const direction = hp[start+j+1].clone().sub(hp[start+j]);
              if (direction.lengthSq() < 1e-8) { result.warnings.push(`${side}.${finger}: degenerate finger segment.`); continue; }
              const key = `${side}.${finger}.${j}`;
              const local = direction.clone().applyQuaternion(parentWorld.clone().invert()).normalize();
              const isThumb = f===0;
              const flex = constrainedAngle(Math.atan2(local.z, local.y),isThumb ? -25 : (j===0 ? -15 : 0),j===0 ? 95 : 115,key,result.corrections);
              const spreadLimit = j===0 ? (isThumb ? 75 : 25) : 5;
              const spread = constrainedAngle(-Math.atan2(local.x, Math.hypot(local.y,local.z)), -spreadLimit,spreadLimit,key,result.corrections);
              const rotation = eulerQuat(flex,0,spread);
              result.pose.rotations[key] = qa(rotation);
              // Estimate child angles from source direction, avoiding cascading clamp errors.
              const sourceDirection = direction.clone().applyQuaternion(palmInv).normalize();
              parentWorld = palm.clone().multiply(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),sourceDirection));
            }
          }
          result.pose.quality[side] = Math.min(reliability,hand.score);
          result.pose.quality[`${side}State`] = 'tracked';
          this.lastGood[side] = frame.timestamp;
        } else result.warnings.push(`${side}: palm basis degenerate.`);
      }
      if (result.pose.quality[`${side}State`] === 'missing' && this.previous && frame.timestamp-this.lastGood[side] <= 200 && this.previous.pose.quality[`${side}State`] !== 'missing') {
        for (const key of Object.keys(result.pose.rotations)) if (key.startsWith(`${side}.`) && !key.endsWith('.upper') && !key.endsWith('.lower')) result.pose.rotations[key] = this.previous.pose.rotations[key];
        result.pose.quality[`${side}State`] = 'held';
        result.warnings.push(`${side}: last handshape held for ≤200 ms, confidence zero.`);
      }
      if (arm.wrist.z < -0.15) result.warnings.push(`${side}: wrist behind torso; verify monocular depth.`);
      if (hand && this.previous?.assignment[side] !== undefined) {
        const old = this.previous.hands[this.previous.assignment[side]!]!.image[0], next = hand.image[0];
        if (Math.hypot(next.x-old.x,next.y-old.y)/dt > 3.5) result.warnings.push(`${side}: rapid image-space wrist jump; inspect frame.`);
      }
    }
    // Adaptive quaternion low-pass: large, fast changes receive less smoothing.
    if (this.previous?.pose.quality.body && dt < 0.2) for (const [key,value] of Object.entries(result.pose.rotations)) {
      const side = key.split('.')[0] as Side;
      if (SIDES.includes(side) && (result.pose.quality[`${side}State`] !== 'tracked' || this.previous.pose.quality[`${side}State`] !== 'tracked')) continue;
      const old = q(this.previous.pose.rotations[key]), next = q(value);
      const speed = old.angleTo(next)/dt;
      const cutoff = (key.split('.').length===3 ? 10 : 7) + 1.2*speed;
      const alpha = 1-Math.exp(-2*Math.PI*cutoff*dt);
      result.pose.rotations[key] = qa(old.slerp(next,alpha));
    }
    if (result.corrections.length) result.warnings.push(`${result.corrections.length} anatomical constraint correction(s); inspect gesture distortion.`);
    this.previous = result;
    return result;
  }
}
