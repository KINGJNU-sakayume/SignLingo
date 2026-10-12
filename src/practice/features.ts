import { Quaternion, Vector3 } from 'three';
import { basisQuaternion, cameraToAvatar, confidence, valid } from '../motion/math';
import { palmFrame } from '../motion/hand';
import { SIDES, type MotionClip, type MotionFrame, type Side } from '../motion/types';
import type { Interval } from './types';
export type HandFeature = { shape: Vector3[]; bend: number[]; palm: Quaternion; position: Vector3; face?: Vector3 };
export type Feature = { index: number; time: number; hands: Partial<Record<Side, HandFeature>> };
const degrees = 180 / Math.PI;
export function frameFeature(frame: MotionFrame, index: number): Feature {
  const feature: Feature = { index, time: frame.timestamp / 1000, hands: {} };
  const good = (i: number) => confidence(frame.body[i]) >= .6 && confidence(frame.bodyWorld[i]) >= .6;
  if (![11,12,23,24].every(good)) return feature;
  const p = frame.bodyWorld.map(cameraToAvatar);
  const center = p[11].clone().add(p[12]).multiplyScalar(.5);
  const up = center.clone().sub(p[23].clone().add(p[24]).multiplyScalar(.5));
  const x = p[11].clone().sub(p[12]), width = x.length(), height = up.length();
  if (width < .08 || height < .1 || x.clone().cross(up).length() / (width*height) < .3) return feature;
  const inverse = basisQuaternion(up, x)?.invert();
  if (!inverse) return feature;
  const relative = (v: Vector3) => v.clone().sub(center).applyQuaternion(inverse).divide(new Vector3(width,height,width));
  for (const side of SIDES) {
    const wrist = side === 'left' ? 15 : 16;
    const assigned = frame.assignment[side], hand = assigned === undefined ? undefined : frame.hands[assigned];
    // Held/interpolated poses, ambiguous identity and low-confidence points are not evidence.
    if (!hand || !good(wrist) || frame.pose.quality[`${side}State`] !== 'tracked' || frame.pose.quality[side] < .6 || hand.score < .6 || hand.world.length !== 21 || !hand.world.every(p => valid(p) && confidence(p) >= .6)) continue;
    const hp = hand.world.map(cameraToAvatar), palm = palmFrame(hp,side);
    if (!palm || palm.conditioning < .3) continue;
    const shape: Vector3[] = [], bend: number[] = [];
    for (let finger = 0; finger < 5; finger++) {
      const start = 1+finger*4, segments = [];
      for (let j = 0; j < 3; j++) segments.push(hp[start+j+1].clone().sub(hp[start+j]));
      if (segments.some(v => v.length() < .003 || v.length() > .1)) break;
      shape.push(...segments.map(v => v.clone().normalize().applyQuaternion(palm.rotation.clone().invert())));
      bend.push((segments[0].angleTo(segments[1])+segments[1].angleTo(segments[2]))*degrees);
    }
    if (shape.length !== 15) continue;
    feature.hands[side] = { shape, bend, palm: inverse.clone().multiply(palm.rotation), position: relative(p[wrist]), ...(good(0) ? {face: relative(p[wrist]).sub(relative(p[0]))} : {}) };
  }
  return feature;
}
export const features = (clip: MotionClip) => clip.frames.map(frameFeature);
export const shapeDistance = (a: HandFeature, b: HandFeature) => a.shape.reduce((sum,v,i)=>sum+v.angleTo(b.shape[i])*degrees,0)/15;
export const palmDistance = (a: HandFeature,b: HandFeature) => a.palm.angleTo(b.palm)*degrees;
export function activeInterval(clip: MotionClip): Interval {
  const f = features(clip), last = f.at(-1)?.time ?? 0;
  const full: Interval = {start:0,end:last,method:'full',note:'No clear activity boundary; select the complete sign manually, including meaningful holds.'};
  if (f.length < 4) return full;
  const activity: number[] = [];
  for (let i=1;i<f.length;i++) {
    const dt = f[i].time-f[i-1].time;
    if (dt <= 0 || dt > .3) continue;
    const moving = SIDES.some(side => {
      const a=f[i-1].hands[side], b=f[i].hands[side];
      return a && b && (a.position.distanceTo(b.position)/dt > .16 || shapeDistance(a,b)/dt > 22 || palmDistance(a,b)/dt > 35);
    });
    if (moving) activity.push(i);
  }
  // Do not infer boundaries from a single tracking jump.
  if (activity.length < 2) return full;
  return {start:Math.max(0,f[activity[0]-1].time-.25),end:Math.min(last,f[activity.at(-1)!].time+.25),method:'activity',note:'Motion heuristic with 250 ms padding. Check that meaningful holds and the full sign are included.'};
}
export function selectedFeatures(clip: MotionClip, interval: Interval): Feature[] {
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end <= interval.start || interval.end > clip.source.duration+.001) throw new Error('Choose a valid signing interval.');
  const selected = features(clip).filter(f=>f.time>=interval.start-1e-6 && f.time<=interval.end+1e-6);
  if (selected.length < 3) throw new Error('Each signing interval needs at least three captured frames.');
  // Bound DTW memory/CPU without inventing measurements across tracking gaps.
  if (selected.length <= 180) return selected;
  return Array.from({length:180},(_,i)=>selected[Math.round(i*(selected.length-1)/179)]);
}
