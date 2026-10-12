import { describe,expect,it } from 'vitest';
import { Quaternion,Vector3 } from 'three';
import { activeInterval, frameFeature } from '../src/practice/features';
import { compareMotion } from '../src/practice/compare';
import { practiceClip } from './practice-fixtures';
import type { Component, Interval } from '../src/practice/types';
import type { MotionClip, Side } from '../src/motion/types';
const full=(c:MotionClip):Interval=>({start:0,end:c.frames.at(-1)!.timestamp/1000,method:'manual'});
const compare=(a:MotionClip,b:MotionClip)=>compareMotion(a,b,full(a),full(b));
const value=(r:ReturnType<typeof compare>,component:Component,side:Side='left')=>r.metrics.find(m=>m.component===component&&m.side===side)!.value!;
describe('technical motion comparison (synthetic geometry, not KSL validity)',()=>{
  it('identical sequences have zero residuals and a diagonal alignment',()=>{
    const a=practiceClip(),r=compare(a,a);
    expect(r.metrics.filter(m=>m.component!=='direction').every(m=>m.value!==null&&m.value<1e-5)).toBe(true);
    // A nearly stationary hand has no reliable direction; it is not scored as a mismatch.
    expect(r.metrics.filter(m=>m.component==='direction').every(m=>m.value===null||m.value<1e-5)).toBe(true);
    expect(r.pairs.every(p=>p.reference===p.learner)).toBe(true);expect(r.feedback).toEqual([]);expect(r.durationRatio).toBe(1);
  });
  it.each([.6,1.8])('aligns resampled %.1fx duration without penalizing speed',factor=>{
    const a=practiceClip(),b=practiceClip({duration:2*factor,count:Math.round(30*factor)+1}),r=compare(a,b);
    expect(value(r,'handshape')).toBeLessThan(2);expect(value(r,'position')).toBeLessThan(.03);
    expect(r.durationRatio).toBeCloseTo(factor);expect(r.feedback.filter(f=>f.kind==='observed')).toEqual([]);
    expect(r.pairs.some(p=>p.reference!==p.learner)).toBe(true);
  });
  it('absorbs a slower start through a nonlinear sequence alignment',()=>{
    const a=practiceClip(),b=structuredClone(a);b.frames.forEach((f,i)=>f.timestamp=Math.pow(i/(b.frames.length-1),.65)*2000);
    const r=compare(a,b);expect(value(r,'handshape')).toBeLessThan(1e-5);expect(r.maxWarp).toBeGreaterThan(.1);
  });
  it('normalizes shoulder/torso proportions, finger lengths, camera translation and rotation',()=>{
    const a=practiceClip(),b=structuredClone(a),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4);
    for(const f of b.frames){
      for(const p of f.bodyWorld){p.x*=1.3;p.y*=.8;p.z*=1.3;const v=new Vector3(p.x,p.y,p.z).applyQuaternion(q).add(new Vector3(2,-3,4));Object.assign(p,v);}
      for(const hand of f.hands){
        // Each phalanx gets its own length; preserve independent measured directions.
        const original=structuredClone(hand.world);
        for(let finger=0;finger<5;finger++)for(let j=1;j<4;j++){
          const i=1+finger*4+j,prev=hand.world[i-1],delta=new Vector3(original[i].x-original[i-1].x,original[i].y-original[i-1].y,original[i].z-original[i-1].z).multiplyScalar(.8+j*.12);Object.assign(hand.world[i],delta.add(new Vector3(prev.x,prev.y,prev.z)));
        }
        for(const p of hand.world)Object.assign(p,new Vector3(p.x,p.y,p.z).applyQuaternion(q));
      }
    }
    const r=compare(a,b);expect(value(r,'position')).toBeLessThan(1e-10);expect(value(r,'handshape')).toBeLessThan(1e-5);expect(value(r,'palm')).toBeLessThan(1e-5);
  });
  it('does not double-reflect canonical MotionClips extracted from mirrored video',()=>{
    const a=practiceClip(),b=structuredClone(a);b.source.mirrored=true;
    const r=compare(a,b);expect(value(r,'position')).toBe(0);expect(value(r,'handshape')).toBeLessThan(1e-5);
  });
  it('keeps anatomical identities instead of minimizing error by swapping hands',()=>{
    const a=practiceClip(),b=structuredClone(a);
    for(const f of b.frames){[f.bodyWorld[15],f.bodyWorld[16]]=[f.bodyWorld[16],f.bodyWorld[15]];[f.assignment.left,f.assignment.right]=[f.assignment.right,f.assignment.left];}
    const r=compare(a,b);expect(value(r,'position')).toBeGreaterThan(1);expect(value(r,'trajectory')).toBeGreaterThan(.15);
  });
  it('missing and held hands produce uncertainty, never a perfect match or a handshape claim',()=>{
    const a=practiceClip(),b=structuredClone(a);
    for(const f of b.frames){f.hands=[];f.assignment={};f.pose.quality.leftState='held';f.pose.quality.rightState='missing';}
    const r=compare(a,b);expect(r.metrics.every(m=>m.value===null&&m.coverage===0)).toBe(true);expect(r.feedback.every(f=>f.kind==='tracking')).toBe(true);expect(r.evidence).toBe('limited');
  });
  it('an incomplete gesture retains mismatching endpoints and geometric residuals',()=>{
    const a=practiceClip(),b=practiceClip({endPhase:.4}),r=compare(a,b);
    expect(r.pairs.at(-1)).toMatchObject({reference:30,learner:30});expect(value(r,'handshape')).toBeGreaterThan(4);expect(value(r,'trajectory')).toBeGreaterThan(.06);
  });
  it('incorrect handshapes and palm orientations are measured separately',()=>{
    const a=practiceClip(),b=structuredClone(a);
    for(const f of b.frames)for(const hand of f.hands)for(let j=6;j<=8;j++){hand.world[j].x=hand.world[5].x;hand.world[j].y=hand.world[5].y-(j-5)*.025;hand.world[j].z=hand.world[5].z;}
    expect(compare(a,b).feedback.some(f=>f.key==='index')).toBe(true);expect(value(compare(a,b),'handshape')).toBeGreaterThan(1);expect(value(compare(a,b),'palm')).toBeLessThan(1e-5);
    const c=structuredClone(a),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
    for(const f of c.frames)for(const hand of f.hands)for(const p of hand.world)Object.assign(p,new Vector3(p.x,p.y,p.z).applyQuaternion(q));
    const r=compare(a,c);expect(value(r,'palm')).toBeGreaterThan(70);expect(value(r,'handshape')).toBeLessThan(1e-5);expect(r.feedback.some(f=>f.key==='palm')).toBe(true);
  });
  it('detects middle activity with padding and permits explicit complete intervals',()=>{
    const a=practiceClip({duration:4,count:61,idle:true}),interval=activeInterval(a);
    expect(interval.method).toBe('activity');expect(interval.start).toBeGreaterThan(.6);expect(interval.end).toBeLessThan(3.4);
    const r=compareMotion(a,a,{start:1,end:3,method:'manual'},{start:1,end:3,method:'manual'});expect(r.pairs[0].referenceTime).toBe(1);expect(r.pairs.at(-1)!.referenceTime).toBe(3);
  });
  it('static holds fall back to manual/full selection and short intervals fail clearly',()=>{
    const a=practiceClip({endPhase:0});expect(activeInterval(a).method).toBe('full');
    expect(()=>compareMotion(a,a,{start:1,end:1.001,method:'manual'})).toThrow('three');
  });
  it('confidence gaps and isolated outliers cannot support specific feedback',()=>{
    const a=practiceClip(),b=structuredClone(a);b.frames[15].bodyWorld[15].y+=1;
    expect(compare(a,b).feedback.some(f=>f.key==='low')).toBe(false);
    for(const f of b.frames){f.bodyWorld[15].visibility=.1;f.bodyWorld[15].y+=1;}
    expect(frameFeature(b.frames[10],10).hands.left?.position).toBeUndefined();expect(frameFeature(b.frames[10],10).hands.left?.shape).toHaveLength(15);expect(compare(a,b).feedback.filter(f=>f.side==='left').every(f=>f.kind==='tracking')).toBe(true);
  });
  it('detects a changed relative phase between both hands',()=>{
    const a=practiceClip(),b=structuredClone(a);
    b.frames.forEach((f,i)=>{const delayed=a.frames[Math.max(0,i-12)];f.bodyWorld[16]=structuredClone(delayed.bodyWorld[16]);f.hands[1]=structuredClone(delayed.hands[1]);});
    const r=compare(a,b),coordination=r.metrics.find(m=>m.component==='coordination')!;expect(coordination.value).toBeGreaterThan(.025);
  });
  it('cannot hide reversed order as an identical gesture',()=>{
    const r=compare(practiceClip(),practiceClip({reverse:true}));expect(value(r,'handshape')).toBeGreaterThan(8);expect(value(r,'direction')).toBeGreaterThan(60);
  });
});
