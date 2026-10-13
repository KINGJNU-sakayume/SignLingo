import { Quaternion, Vector2, Vector3 } from 'three';
import { basisQuaternion, cameraToAvatar, confidence } from '../motion/math';
import type { MotionClip, MotionFrame } from '../motion/types';
export const reliableImage=(f:MotionFrame,i:number)=>confidence(f.body[i])>=.6 && f.body[i].x>=0 && f.body[i].x<=1 && f.body[i].y>=0 && f.body[i].y<=1;
export const reliableWorld=(f:MotionFrame,i:number)=>reliableImage(f,i)&&confidence(f.bodyWorld[i])>=.6;
const shoulderRotation=(axis:Vector3)=>{const x=axis.clone().normalize(),up=new Vector3(0,1,0).addScaledVector(x,-x.y);return up.length()>.3?basisQuaternion(up,x):null;};
const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
export type UpperBodyFrame = {
  origin?:Vector3; width?:number; inverse?:Quaternion;
  imageOrigin?:Vector2; imageWidth?:number; imageX?:Vector2; imageUp?:Vector2;
  pitchSource:'camera-up'|'stable-head-calibration';
};
// Two shoulders constrain yaw/roll, but cannot identify pitch around their own
// axis. Optional head geometry calibrates ONE constant, only if stable over time.
// Dynamic head landmarks never become a per-frame rigid torso axis. Hips are unused.
export function calibratedUp(clip:MotionClip): {up:Vector3;source:UpperBodyFrame['pitchSource']} {
  const observations=clip.frames.flatMap(f=>{
    if(![7,8,11,12].every(i=>reliableWorld(f,i)))return [];
    const center=cameraToAvatar(f.bodyWorld[11]).add(cameraToAvatar(f.bodyWorld[12])).multiplyScalar(.5);
    const head=cameraToAvatar(f.bodyWorld[7]).add(cameraToAvatar(f.bodyWorld[8])).multiplyScalar(.5).sub(center);
    const x=cameraToAvatar(f.bodyWorld[11]).sub(cameraToAvatar(f.bodyWorld[12])).normalize();
    // Account for roll/yaw before estimating the one otherwise unobservable pitch.
    const base=shoulderRotation(x);if(!base)return [];
    head.applyQuaternion(base.invert());
    if(head.y<.04)return [];
    return [{angle:Math.atan2(head.z,head.y),time:f.timestamp}];
  });
  if(observations.length>=5 && observations.at(-1)!.time-observations[0].time>=250) {
    const angles=observations.map(o=>o.angle),angle=median(angles),sorted=[...angles].sort((a,b)=>a-b);
    const spread=sorted[Math.floor((sorted.length-1)*.9)]-sorted[Math.floor((sorted.length-1)*.1)];
    if(Math.abs(angle)<=Math.PI/7.2 && spread<Math.PI/30 && median(angles.map(a=>Math.abs(a-angle)))<Math.PI/60)
      return {up:new Vector3(0,Math.cos(angle),Math.sin(angle)),source:'stable-head-calibration'};
  }
  return {up:new Vector3(0,1,0),source:'camera-up'};
}
export class UpperBodyTracker {
  private previous?:{time:number;rotation:Quaternion;width:number};
  constructor(private up=new Vector3(0,1,0),private source:UpperBodyFrame['pitchSource']='camera-up'){}
  frame(f:MotionFrame,width=1,height=1):UpperBodyFrame {
    const result:UpperBodyFrame={pitchSource:this.source};
    if([11,12].every(i=>reliableImage(f,i))) {
      const image=(i:number)=>new Vector2(f.body[i].x*width,-f.body[i].y*height);
      const left=image(11),right=image(12),axis=left.clone().sub(right),span=axis.length();
      if(span>=Math.max(width,height)*.015){
        const x=axis.divideScalar(span),up=new Vector2(-x.y,x.x);if(up.y<0)up.multiplyScalar(-1);
        Object.assign(result,{imageOrigin:left.add(right).multiplyScalar(.5),imageWidth:span,imageX:x,imageUp:up});
      }
    }
    if(![11,12].every(i=>reliableWorld(f,i))){this.previous=undefined;return result;}
    const left=cameraToAvatar(f.bodyWorld[11]),right=cameraToAvatar(f.bodyWorld[12]),x=left.clone().sub(right),span=x.length();
    if(span<.08||span>1.2){this.previous=undefined;return result;}
    // Use the observed shoulder axis exactly; project camera up orthogonal to it.
    // Apply stable pitch around the local shoulder axis, preserving roll/yaw.
    const base=shoulderRotation(x);
    if(!base){this.previous=undefined;return result;}
    const pitch=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.atan2(this.up.z,this.up.y));
    let rotation=base.multiply(pitch),scale=span;
    const prev=this.previous,dt=prev?(f.timestamp-prev.time)/1000:0;
    if(prev&&dt>0&&dt<=.3) {
      // Suppress only small frame jitter. Meaningful rotations/scale changes are
      // adopted immediately rather than low-pass filtering an entire body motion.
      const alpha=1-Math.exp(-dt/.035);
      if(rotation.angleTo(prev.rotation)<Math.PI/90)rotation=prev.rotation.clone().slerp(rotation,alpha);
      if(Math.abs(span/prev.width-1)<.025)scale=prev.width+(span-prev.width)*alpha;
    }
    this.previous={time:f.timestamp,rotation:rotation.clone(),width:scale};
    return {...result,origin:left.add(right).multiplyScalar(.5),width:scale,inverse:rotation.invert()};
  }
}
export const worldRelative=(f:MotionFrame,i:number,b:UpperBodyFrame)=>reliableWorld(f,i)&&b.inverse&&b.origin&&b.width?cameraToAvatar(f.bodyWorld[i]).sub(b.origin).applyQuaternion(b.inverse).divideScalar(b.width):undefined;
export function imageRelative(f:MotionFrame,i:number,b:UpperBodyFrame,width:number,height:number) {
  if(!reliableImage(f,i)||!b.imageOrigin||!b.imageWidth||!b.imageX||!b.imageUp)return undefined;
  const v=new Vector2(f.body[i].x*width,-f.body[i].y*height).sub(b.imageOrigin);
  return new Vector2(v.dot(b.imageX),v.dot(b.imageUp)).divideScalar(b.imageWidth);
}
