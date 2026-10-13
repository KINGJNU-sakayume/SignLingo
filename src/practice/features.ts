import { UpperBodyTracker, calibratedUp, imageRelative, reliableImage, worldRelative, type UpperBodyFrame } from './upperBody';
import { Quaternion, Vector2, Vector3 } from 'three';
import { cameraToAvatar, confidence, valid } from '../motion/math';
import { palmFrame } from '../motion/hand';
import { SIDES, type MotionClip, type MotionFrame, type Side } from '../motion/types';
import type { Interval } from './types';
export type HandFeature = {
  shape?: Vector3[]; bend?: number[]; palm?: Quaternion; position?: Vector3; face?: Vector3;
  position2D?: Vector2; face2D?: Vector2; basis:'upper-body'|'none'; identity:'wrist'|'label'|'pose';
};
export type Feature = { index:number; time:number; hands:Partial<Record<Side,HandFeature>> };
const degrees=180/Math.PI;
export function frameFeature(frame:MotionFrame,index:number,body?:UpperBodyFrame,width=1,height=1):Feature {
  const feature:Feature={index,time:frame.timestamp/1000,hands:{}};
  body??=new UpperBodyTracker().frame(frame,width,height);
  for(const side of SIDES) {
    const wrist=side==='left'?15:16,assigned=frame.assignment[side];
    const wristIdentity=assigned!==undefined&&reliableImage(frame,wrist);
    const candidates=frame.hands.filter(h=>h.label.toLowerCase()===side&&h.score>=.9);
    const hand=wristIdentity?frame.hands[assigned!]:frame.body.length===0&&candidates.length===1?candidates[0]:undefined;
    const position=worldRelative(frame,wrist,body),nose=worldRelative(frame,0,body);
    const position2D=imageRelative(frame,wrist,body,width,height),nose2D=imageRelative(frame,0,body,width,height);
    const observed:HandFeature={basis:body.inverse?'upper-body':'none',identity:wristIdentity?'wrist':hand?'label':'pose',position,position2D,
      face:position&&nose?position.clone().sub(nose):undefined,face2D:position2D&&nose2D?position2D.clone().sub(nose2D):undefined};
    if(hand&&hand.score>=.6&&hand.image.length===21&&hand.world.length===21&&[0,5,9,17].every(i=>valid(hand.image[i])&&valid(hand.world[i])&&confidence(hand.world[i])>=.6)) {
      const hp=hand.world.map(cameraToAvatar),palm=palmFrame(hp,side);
      if(palm&&palm.conditioning>=.6) {
        if(body.inverse)observed.palm=body.inverse.clone().multiply(palm.rotation);
        const shape:Vector3[]=[],bend:number[]=[];
        const fingersReliable=hand.image.every(valid)&&hand.world.every(p=>valid(p)&&confidence(p)>=.6);
        for(let finger=0;finger<5;finger++) {
          if(!fingersReliable)break;
          const start=1+finger*4,segments=[];
          for(let j=0;j<3;j++)segments.push(hp[start+j+1].clone().sub(hp[start+j]));
          if(segments.some(v=>v.length()<.003||v.length()>.1))break;
          shape.push(...segments.map(v=>v.clone().normalize().applyQuaternion(palm.rotation.clone().invert())));
          bend.push((segments[0].angleTo(segments[1])+segments[1].angleTo(segments[2]))*degrees);
        }
        if(shape.length===15){observed.shape=shape;observed.bend=bend;}
      }
    }
    if(observed.shape||observed.palm||position||position2D)feature.hands[side]=observed;
  }
  return feature;
}
export function features(clip:MotionClip) {
  const calibration=calibratedUp(clip),tracker=new UpperBodyTracker(calibration.up,calibration.source);
  return clip.frames.map((f,i)=>frameFeature(f,i,tracker.frame(f,clip.source.width,clip.source.height),clip.source.width,clip.source.height));
}
export const shapeDistance=(a:HandFeature,b:HandFeature)=>a.shape&&b.shape?a.shape.reduce((sum,v,i)=>sum+v.angleTo(b.shape![i])*degrees,0)/15:undefined;
export const palmDistance=(a:HandFeature,b:HandFeature)=>a.palm&&b.palm?a.palm.angleTo(b.palm)*degrees:undefined;
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
      return a && b && ((a.position && b.position && a.position.distanceTo(b.position)/dt > .16) || (shapeDistance(a,b)??0)/dt > 22 || (palmDistance(a,b) ?? 0)/dt > 35);
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
  // Select existing observations near uniform TIME bins, not uniform indices.
  const chosen=new Set<number>([0,selected.length-1]);let cursor=0;
  for(let i=1;i<179;i++){const target=selected[0].time+(selected.at(-1)!.time-selected[0].time)*i/179;while(cursor+1<selected.length&&Math.abs(selected[cursor+1].time-target)<Math.abs(selected[cursor].time-target))cursor++;chosen.add(cursor);}
  return [...chosen].sort((a,b)=>a-b).map(i=>selected[i]);
}
