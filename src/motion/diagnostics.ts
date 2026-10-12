import { Vector3 } from 'three';
import { alignHand, arr, normalizeBody, q, rad } from './math';
import { palmFrame } from './hand';
import { forwardArm, forwardHand } from './rig';
import { FINGERS, SIDES, type MotionClip, type MotionFrame, type Side, type Vec3 } from './types';
const degrees = (r: number) => r * 180 / Math.PI;
export const mean = (values: number[]) => values.length ? values.reduce((a,b) => a+b, 0) / values.length : null;
export function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1, Math.floor((sorted.length-1)*fraction))];
}
export type SegmentDiagnostic = {
  joint: string; detectedStart: Vec3; detectedEnd: Vec3; reconstructedStart: Vec3; reconstructedEnd: Vec3;
  detectedDirection: Vec3; reconstructedDirection: Vec3;
  directionDegrees: number; palmLocalDegrees: number; positionMm: number;
  flexDegrees: number; spreadDegrees: number; correctionRadians: number; correctionMeters: number;
};
export type HandDiagnostic = {
  side: Side; segments: SegmentDiagnostic[]; detected: Vec3[]; reconstructed: Vec3[];
  palmDegrees: number; wristPositionMm: number; elbowDegrees: number;
};
export type FrameDiagnostic = {
  timestamp: number; hands: Partial<Record<Side, HandDiagnostic>>;
  suddenRotations: { joint: string; degrees: number; degreesPerSecond: number }[];
  identityEvents: string[]; elbowEvents: string[];
};
export function inspectFrame(frame: MotionFrame, previous?: MotionFrame): FrameDiagnostic {
  const result: FrameDiagnostic = { timestamp: frame.timestamp, hands: {}, suddenRotations: [], identityEvents: [], elbowEvents: [] };
  const body = normalizeBody(frame.bodyWorld);
  const dt = previous ? (frame.timestamp-previous.timestamp)/1000 : 0;
  const adjacent = !!previous && dt > 0 && dt <= .2;
  for (const side of SIDES) {
    const fk = forwardArm(frame.pose, side);
    const wristIndex = side === 'left' ? 15 : 16;
    const handIndex = frame.assignment[side];
    const source = handIndex === undefined ? undefined : frame.hands[handIndex];
    if (source && body?.points[wristIndex] && frame.pose.quality[`${side}State`] === 'tracked') {
      // Body anchor is deliberately NOT replaced with the IK wrist: reach error must stay visible.
      const hp = alignHand(source.world, body.points[wristIndex]!)!;
      const palm = hp && palmFrame(hp, side);
      if (palm) {
        const hand = forwardHand(frame.pose, side);
        const segments: SegmentDiagnostic[] = [];
        hand.segments.forEach((segment, index) => {
          const start = 1 + Math.floor(index/3)*4 + index%3;
          const sourceVector = hp[start+1].clone().sub(hp[start]);
          if (sourceVector.lengthSq() < 1e-10) return;
          const detectedDirection = sourceVector.normalize();
          const localSource = detectedDirection.clone().applyQuaternion(palm.rotation.clone().invert());
          const localRig = segment.direction.clone().applyQuaternion(hand.palm.clone().invert());
          const localJoint = new Vector3(0,1,0).applyQuaternion(q(frame.pose.rotations[segment.joint]));
          const corrections = frame.corrections.filter(c => c.joint === segment.joint);
          segments.push({ joint: segment.joint, detectedStart: arr(hp[start]), detectedEnd: arr(hp[start+1]), reconstructedStart: arr(segment.start), reconstructedEnd: arr(segment.end), detectedDirection: arr(detectedDirection), reconstructedDirection: arr(segment.direction), directionDegrees: degrees(segment.direction.angleTo(detectedDirection)), palmLocalDegrees: degrees(localRig.angleTo(localSource)), positionMm: segment.end.distanceTo(hp[start+1])*1000, flexDegrees: degrees(Math.atan2(localJoint.z,localJoint.y)), spreadDegrees: degrees(-Math.atan2(localJoint.x,Math.hypot(localJoint.y,localJoint.z))), correctionRadians: corrections.filter(c=>c.kind.endsWith('radians')).reduce((a,c)=>a+c.amount,0), correctionMeters: corrections.filter(c=>c.kind.endsWith('meters')).reduce((a,c)=>a+c.amount,0) });
        });
        result.hands[side] = { side, segments, detected: hp.map(arr), reconstructed: hand.points.map(arr), palmDegrees: degrees(palm.rotation.angleTo(hand.palm)), wristPositionMm: hand.wrist.distanceTo(hp[0])*1000, elbowDegrees: degrees(hand.elbow.clone().sub(hand.shoulder).angleTo(hand.wrist.clone().sub(hand.elbow))) };
      }
    }
    if (adjacent && frame.pose.quality[`${side}Arm`] > 0 && previous!.pose.quality[`${side}Arm`] > 0) {
      const old = forwardArm(previous!.pose, side);
      const normal = fk.elbow.clone().sub(fk.shoulder).cross(fk.wrist.clone().sub(fk.elbow));
      const oldNormal = old.elbow.clone().sub(old.shoulder).cross(old.wrist.clone().sub(old.elbow));
      if (normal.length() < .004 || oldNormal.length() < .004) result.elbowEvents.push(`${side}: elbow plane near singularity`);
      else if (normal.angleTo(oldNormal) > rad(60)) result.elbowEvents.push(`${side}: elbow plane changed >60°`);
    }
    if (adjacent && source) {
      const oldIndex = previous!.assignment[side];
      const old = oldIndex === undefined ? undefined : previous!.hands[oldIndex];
      if (old) {
        if (source.label !== old.label) result.identityEvents.push(`${side}: handedness label changed (proxy, not a confirmed swap)`);
        const other = side === 'left' ? 'right' : 'left';
        const otherIndex = previous!.assignment[other];
        const otherSource = otherIndex === undefined ? undefined : previous!.hands[otherIndex];
        const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
        if (otherSource && distance(source.image[0], otherSource.image[0]) + .04 < distance(source.image[0], old.image[0])) result.identityEvents.push(`${side}: cross-association proximity change; inspect identity`);
      }
    }
  }
  if (adjacent) {
    for (const [joint, rotation] of Object.entries(frame.pose.rotations)) {
      const side = joint.split('.')[0] as Side;
      if (SIDES.includes(side) && (frame.pose.quality[`${side}State`] !== 'tracked' || previous!.pose.quality[`${side}State`] !== 'tracked')) continue;
      if (!frame.pose.quality.body || !previous!.pose.quality.body) continue;
      const change = degrees(q(rotation).angleTo(q(previous!.pose.rotations[joint])));
      if (change > 35 && change/dt > 720) result.suddenRotations.push({joint,degrees:change,degreesPerSecond:change/dt});
    }
    for (const side of SIDES) if (result.hands[side] && previous!.pose.quality[`${side}State`] === 'tracked') {
      const change = degrees(forwardHand(frame.pose,side).palm.angleTo(forwardHand(previous!.pose,side).palm));
      if (change > 35 && change/dt > 720) result.suddenRotations.push({joint:`${side}.palm-world`,degrees:change,degreesPerSecond:change/dt});
    }
  }
  return result;
}
export function inspectClip(clip: MotionClip) {
  const frames = clip.frames.map((f,i)=>inspectFrame(f,clip.frames[i-1]));
  const segments = frames.flatMap(f=>SIDES.flatMap(side=>f.hands[side]?.segments ?? []));
  const hands = frames.flatMap(f=>SIDES.flatMap(side=>f.hands[side] ? [f.hands[side]!] : []));
  const corrections: Record<string,{ count:number; radians:number; meters:number }> = {};
  for (const frame of clip.frames) for (const c of frame.corrections) {
    const item = corrections[c.joint] ??= {count:0,radians:0,meters:0}; item.count++;
    if (c.kind.endsWith('radians')) item.radians+=c.amount;
    if (c.kind.endsWith('meters')) item.meters+=c.amount;
  }
  const coverage = Object.fromEntries(SIDES.map(side=>[side,{
    assigned: clip.frames.filter(f=>f.assignment[side]!==undefined).length,
    tracked: clip.frames.filter(f=>f.pose.quality[`${side}State`]==='tracked').length,
    held: clip.frames.filter(f=>f.pose.quality[`${side}State`]==='held').length,
    missing: clip.frames.filter(f=>f.pose.quality[`${side}State`]==='missing').length,
  }])) as Record<Side,{assigned:number;tracked:number;held:number;missing:number}>;
  const paths = SIDES.map(side=>{
    let length=0, count=0; const speeds:number[]=[];
    clip.frames.forEach((f,i)=>{const prev=clip.frames[i-1];if(!prev || f.timestamp-prev.timestamp>200 || f.pose.quality[`${side}State`]!=='tracked' || prev.pose.quality[`${side}State`]!=='tracked')return;const distance=forwardArm(f.pose,side).wrist.distanceTo(forwardArm(prev.pose,side).wrist);length+=distance;count++;speeds.push(distance/((f.timestamp-prev.timestamp)/1000));});
    return {side,lengthMeters:count?length:null,validIntervals:count,peakSpeedMetersPerSecond:speeds.length?Math.max(...speeds):null};
  });
  return { frames, summary: {
    totalFrames:clip.frames.length, detectedHandSets:clip.frames.reduce((a,f)=>a+f.hands.length,0), coverage,
    evaluatedSegments:segments.length, directionMeanDegrees:mean(segments.map(s=>s.directionDegrees)), directionP95Degrees:percentile(segments.map(s=>s.directionDegrees),.95), handshapeMeanDegrees:mean(segments.map(s=>s.palmLocalDegrees)), positionMeanMm:mean(segments.map(s=>s.positionMm)), palmMeanDegrees:mean(hands.map(h=>h.palmDegrees)), wristMeanMm:mean(hands.map(h=>h.wristPositionMm)),
    suddenRotations:frames.reduce((a,f)=>a+f.suddenRotations.length,0),identityEvents:frames.reduce((a,f)=>a+f.identityEvents.length,0),ambiguousIdentityFrames:clip.frames.filter(f=>f.warnings.some(w=>w.includes('Ambiguous hand identity'))).length, elbowEvents:frames.reduce((a,f)=>a+f.elbowEvents.length,0), unusualArticulationFlags:clip.frames.reduce((a,f)=>a+f.warnings.filter(w=>w.includes('unusual estimated articulation')).length,0),corrections, correctionCount:clip.frames.reduce((a,f)=>a+f.corrections.length,0),paths,
    bothHandsTrackedFrames:clip.frames.filter(f=>SIDES.every(side=>f.pose.quality[`${side}State`]==='tracked')).length,
  } };
}
export function pairedDirectionError(a: ReturnType<typeof inspectClip>, b: ReturnType<typeof inspectClip>) {
  const before:number[]=[],after:number[]=[];
  a.frames.forEach((frame,i)=>{for(const side of SIDES)for(const s of frame.hands[side]?.segments??[]){const other=b.frames[i]?.hands[side]?.segments.find(t=>t.joint===s.joint);if(other){before.push(s.directionDegrees);after.push(other.directionDegrees);}}});
  return {segments:before.length,beforeDegrees:mean(before),afterDegrees:mean(after)};
}
export const diagnosticJoints = SIDES.flatMap(side=>FINGERS.flatMap(f=>[0,1,2].map(j=>`${side}.${f}.${j}`)));
