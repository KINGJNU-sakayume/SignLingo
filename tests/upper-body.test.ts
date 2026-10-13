// Analytic geometry and sampling, NOT physical-phone or KSL validation.
import {expect,it} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {features,frameFeature,selectedFeatures} from '../src/practice/features';
import {calibratedUp} from '../src/practice/upperBody';
import {compareMotion} from '../src/practice/compare';
import {practiceClip} from './practice-fixtures';
import {importMotion,exportMotion} from '../src/motion/serialization';
function headClip(){const c=practiceClip();for(const f of c.frames)for(const i of [0,7,8]){f.bodyWorld[i].y=-.9;f.bodyWorld[i].z=0;f.body[i].y=.75-.9/1.3;}return c;}
function missingHips(c= headClip()){for(const f of c.frames)for(const i of [23,24]){f.body[i]={...f.body[i],y:1.5,visibility:0};f.bodyWorld[i].visibility=0;}return c;}
it('every supported component survives absent hips in either or both clips',()=>{
  const full=headClip(),cropped=missingHips();
  for(const [a,b] of [[full,cropped],[cropped,cropped]]){const r=compareMotion(a,b);for(const m of r.metrics.filter(m=>m.component!=='direction'))expect(m.value).toBeLessThan(1e-5);expect(r.metrics.find(m=>m.component==='direction'&&m.side==='left')?.value).toBeLessThan(1e-5);}
});
it.each(['upward','roll'] as const)('handles a slightly %s camera with stable upper-body calibration',kind=>{
  const a=missingHips(),b=structuredClone(a),q=new Quaternion().setFromAxisAngle(kind==='upward'?new Vector3(1,0,0):new Vector3(0,0,1),.15);
  for(const f of b.frames){for(const p of f.bodyWorld)Object.assign(p,new Vector3(p.x,p.y,p.z).applyQuaternion(q));for(const h of f.hands)for(const p of h.world)Object.assign(p,new Vector3(p.x,p.y,p.z).applyQuaternion(q));}
  expect(calibratedUp(b).source).toBe('stable-head-calibration');
  const r=compareMotion(a,b);expect(r.metrics.find(m=>m.component==='palm')?.value).toBeLessThan(.001);expect(r.metrics.find(m=>m.component==='position')?.value).toBeLessThan(.001);
});
it('head movement does not drag torso coordinates; hand-to-face movement remains observable',()=>{
  const a=missingHips(),b=structuredClone(a);
  b.frames.forEach((f,j)=>{for(const i of [0,7,8]){f.bodyWorld[i].z+=Math.sin(j/3)*.12;f.body[i].x+=Math.sin(j/3)*.08;}});
  expect(calibratedUp(b).source).toBe('camera-up');const fa=features(a),fb=features(b);
  expect(fb[10].hands.left!.position!.distanceTo(fa[10].hands.left!.position!)).toBeLessThan(1e-8);
  expect(fb[10].hands.left!.face!.distanceTo(fa[10].hands.left!.face!)).toBeGreaterThan(.03);
});
it('hand-to-face measurement works near the face without hips',()=>{
  const c=missingHips();for(const f of c.frames){f.bodyWorld[15]={...f.bodyWorld[0],x:f.bodyWorld[0].x+.03};f.body[15]={...f.body[0],x:f.body[0].x+.02};}
  const h=features(c)[0].hands.left!;expect(h.face!.length()).toBeLessThan(.1);expect(h.face2D!.length()).toBeLessThan(.1);
});
it.each(['collapsed','uncertain'])('%s finger evidence does not suppress supported palm/wrist measurements',kind=>{
  const f=headClip().frames[0];if(kind==='collapsed')f.hands[0].world[8]={...f.hands[0].world[7]};else f.hands[0].world[8].visibility=.1;const h=frameFeature(f,0).hands.left!;
  expect(h.shape).toBeUndefined();expect(h.palm).toBeDefined();expect(h.position).toBeDefined();
});
it('image-only relationships remain measurable without fabricating 3D coordinates',()=>{
  const a=missingHips(),b=structuredClone(a);for(const f of b.frames)f.bodyWorld=[];
  const h=features(b)[0].hands.left!;expect(h.position).toBeUndefined();expect(h.position2D).toBeDefined();expect(h.shape).toHaveLength(15);expect(h.palm).toBeUndefined();
  const r=compareMotion(a,b);expect(r.metrics.find(m=>m.component==='position')).toMatchObject({space:'image2d',value:0});expect(r.metrics.find(m=>m.component==='palm')?.reason).toContain('shoulders');
});
it('missing shoulders suppress relative metrics but do not suppress handshape',()=>{
  const f=headClip().frames[0];f.body[11].visibility=0;const h=frameFeature(f,0).hands.left!;expect(h.shape).toHaveLength(15);expect(h.position).toBeUndefined();expect(h.palm).toBeUndefined();
});
it('time-based subsampling and DTW do not treat dense frame clusters as long durations',()=>{
  const a=practiceClip({count:500}),b=structuredClone(a);b.frames=b.frames.filter((_,i)=>i<450||i%5===0||i===499);
  const interval={start:0,end:2,method:'manual' as const},chosen=selectedFeatures(b,interval);
  expect(chosen.length).toBeLessThanOrEqual(180);expect(chosen.filter(f=>f.time>1).length).toBeGreaterThan(55);
  const r=compareMotion(a,b,interval,interval);expect(r.maxWarp).toBeLessThan(.04);expect(r.metrics.find(m=>m.component==='handshape')?.value).toBeLessThan(1);
});
it('long tracking gaps reduce temporal evidence instead of becoming long reliable holds',()=>{
  const a=practiceClip({count:61}),b=structuredClone(a);b.frames=b.frames.filter((_,i)=>i<5||i>55);
  const r=compareMotion(a,b,{start:0,end:2,method:'manual'},{start:0,end:2,method:'manual'});
  expect(r.metrics.find(m=>m.component==='handshape')?.value).toBeNull();expect(r.evidence).toBe('limited');
});
it('schema-1 round trips an optional decoded-media offset and old clips',()=>{
  const c=practiceClip();expect(importMotion(exportMotion(c)).source.timeOffset).toBeUndefined();c.source.timeOffset=.033;expect(importMotion(exportMotion(c)).source.timeOffset).toBe(.033);
});
it('movement direction uses a time window rather than disappearing at higher sample rates',()=>{
  const a=practiceClip({count:31}),b=practiceClip({count:61}),r=compareMotion(a,b);
  const direction=r.metrics.find(m=>m.component==='direction'&&m.side==='left')!;
  expect(direction.value).not.toBeNull();expect(direction.coverage).toBeGreaterThan(.85);expect(direction.value).toBeLessThan(10);
});
