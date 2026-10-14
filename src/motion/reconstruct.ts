import { Quaternion, Vector3 } from 'three';
import type { Detection, MotionFrame, Side } from './types';
import { SIDES } from './types';
import { alignHand, basisQuaternion, clamp, confidence, eulerQuat, normalizeBody, qa, rad, solveArm } from './math';
import { inspectFrame } from './diagnostics';
import { assignHands } from './tracking';
import { neutralRotations } from './rig';
import { distributeForearmRoll, palmFrame, reconstructFingers } from './hand';
export { fingerLengths, fingerOffsets, neutralRotations } from './rig';

export class Reconstructor {
  private previous?: MotionFrame;
  private lastGood: Record<Side, number> = { left: -Infinity, right: -Infinity };
  private poles: Partial<Record<Side, Vector3>> = {};
  reconstruct(frame: Detection, associated?: ReturnType<typeof assignHands>): MotionFrame {
    const { assignment, warnings } = associated ?? assignHands(frame);
    // Old poles/handshapes must not bridge cuts, tracking outages or nonmonotonic input.
    if (this.previous && (frame.discontinuity === 'cut' || frame.timestamp <= this.previous.timestamp || frame.timestamp - this.previous.timestamp > 200)) {
      this.previous = undefined; this.poles = {}; this.lastGood = { left: -Infinity, right: -Infinity };
    }
    const result: MotionFrame = { ...frame, assignment, warnings, corrections: [], pose: { root: [0,1.3,0], rotations: neutralRotations(), quality: { body: 0, left: 0, right: 0, leftArm: 0, rightArm: 0, leftState: 'missing', rightState: 'missing' } } };
    const normalized = normalizeBody(frame.bodyWorld);
    const bodyScore = Math.min(...[11,12].map(i => Math.min(confidence(frame.body[i]), confidence(frame.bodyWorld[i]))));
    if (!normalized || bodyScore < .45) {
      warnings.push('Torso tracking unavailable; reconstruction withheld.');
      this.poles = {}; this.previous = result;
      return result;
    }
    result.pose.quality.body = bodyScore;
    warnings.push('Monocular depth and shared hand/body camera axes are estimates, not calibrated geometry.');
    const points = normalized.points;
    const x = points[11]!.clone().sub(points[12]!);
    const hipsValid = [23,24].every(i => points[i] && confidence(frame.body[i]) > .5 && confidence(frame.bodyWorld[i]) > .5);
    const up = hipsValid ? new Vector3(0,1.3,0).sub(points[23]!.clone().add(points[24]!).multiplyScalar(.5)) : new Vector3(0,1,0);
    const torso = basisQuaternion(up, x) ?? new Quaternion();
    result.pose.rotations.torso = qa(torso);
    if (points[0] && points[7] && points[8] && [0,7,8].every(i => confidence(frame.body[i]) > .5)) {
      const center = points[7]!.clone().add(points[8]!).multiplyScalar(.5);
      const face = points[0]!.clone().sub(center).applyQuaternion(torso.clone().invert()).normalize();
      result.pose.rotations.head = qa(eulerQuat(clamp(-Math.atan2(face.y, Math.hypot(face.x, face.z)), rad(-35), rad(35)), clamp(Math.atan2(face.x, Math.max(.05,face.z)), rad(-65), rad(65)), 0));
    } else warnings.push('Head orientation unavailable; neutral head displayed.');
    for (const side of SIDES) {
      const indices = side === 'left' ? [11,13,15] : [12,14,16];
      const reliability = Math.min(...indices.map(i => Math.min(confidence(frame.body[i]), confidence(frame.bodyWorld[i]))));
      if (reliability < .45 || !indices.every(i => points[i])) {
        warnings.push(`${side}: arm landmarks unreliable.`); delete this.poles[side]; continue;
      }
      result.pose.quality[`${side}Arm`] = reliability;
      const shoulder = new Vector3(side === 'left' ? .19 : -.19,0,0).applyQuaternion(torso).add(new Vector3(0,1.3,0));
      const arm = solveArm(shoulder, points[indices[2]]!, points[indices[1]]!, this.poles[side], reliability);
      if (this.poles[side] && this.poles[side]!.dot(arm.pole) < -.7) warnings.push(`${side}: suspected elbow-plane flip; inspect supporting landmarks.`);
      if (arm.unstable) warnings.push(`${side}: elbow plane underdetermined; confidence-weighted temporal pole used where available.`);
      this.poles[side] = arm.pole;
      if (arm.correction > .00001) result.corrections.push({ joint: `${side}.elbow`, kind: 'reach-clamp-meters', amount: arm.correction });
      result.pose.rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(arm.upperQ));
      const handIndex = assignment[side], hand = handIndex === undefined ? undefined : frame.hands[handIndex];
      if (hand) {
        const hp = alignHand(hand.world, arm.wrist)!;
        const palm = palmFrame(hp, side);
        const fingers = palm && reconstructFingers(hp, palm.rotation, side);
        if (palm && fingers) {
          const { forearm, wrist, swing } = distributeForearmRoll(arm.lowerQ, palm.rotation);
          arm.lowerQ.copy(forearm);
          result.pose.rotations[`${side}.wrist`] = qa(wrist);
          Object.assign(result.pose.rotations, fingers.rotations);
          warnings.push(...fingers.warnings);
          if (swing > rad(100)) warnings.push(`${side}: unusual wrist swing; verify body/hand alignment (orientation preserved).`);
          result.pose.quality[side] = Math.min(reliability, hand.score, palm.conditioning);
          result.pose.quality[`${side}State`] = 'tracked';
          this.lastGood[side] = frame.timestamp;
        } else warnings.push(`${side}: palm or finger geometry degenerate; hand reconstruction withheld.`);
      }
      result.pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(arm.lowerQ));
      // Hold world palm orientation, rather than a wrist-local rotation tied to an old forearm roll.
      if (result.pose.quality[`${side}State`] === 'missing' && this.previous && frame.timestamp-this.lastGood[side] <= 200 && this.previous.pose.quality[`${side}State`] !== 'missing') {
        const old = this.previous.pose.rotations;
        const oldPalm = new Quaternion(...old.torso).multiply(new Quaternion(...old[`${side}.upper`])).multiply(new Quaternion(...old[`${side}.lower`])).multiply(new Quaternion(...old[`${side}.wrist`]));
        result.pose.rotations[`${side}.wrist`] = qa(arm.lowerQ.clone().invert().multiply(oldPalm));
        for (const key of Object.keys(old)) if (key.startsWith(`${side}.`) && key.split('.').length === 3) result.pose.rotations[key] = old[key];
        result.pose.quality[`${side}State`] = 'held';
        warnings.push(`${side}: last handshape held for ≤200 ms, confidence zero.`);
      }
      if (hand && this.previous?.assignment[side] !== undefined) {
        const old = this.previous.hands[this.previous.assignment[side]!]!.image[0], next = hand.image[0];
        const dt = (frame.timestamp-this.previous.timestamp)/1000;
        if (dt > 0 && Math.hypot(next.x-old.x,next.y-old.y)/dt > 3.5) warnings.push(`${side}: rapid image-space wrist jump; inspect frame.`);
      }
      if (arm.wrist.z < -.15) warnings.push(`${side}: wrist behind torso; verify monocular depth (position preserved).`);
    }
    if (result.corrections.length) warnings.push(`${result.corrections.length} fixed-rig reach correction(s); inspect position distortion.`);
    const diagnostic = inspectFrame(result, this.previous);
    for (const side of SIDES) {
      const residual = diagnostic.hands[side]?.segments.find(s=>s.directionDegrees > 5);
      if (residual) warnings.push(`${residual.joint}: FK direction residual >5°; inspect reconstruction.`);
    }
    for (const change of diagnostic.suddenRotations) warnings.push(`${change.joint}: sudden rotation ${change.degrees.toFixed(1)}° (${change.degreesPerSecond.toFixed(0)}°/s).`);
    warnings.push(...diagnostic.identityEvents, ...diagnostic.elbowEvents);
    this.previous = result;
    return result;
  }
}
