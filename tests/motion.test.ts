import { describe,it,expect } from 'vitest';
import { Quaternion,Vector3 } from 'three';
import { alignHand,boundWrist,cameraToAvatar,LENGTHS,normalizeBody,qa,q,rad,solveArm,unmirrorImage } from '../src/motion/math';
import { assignHands } from '../src/motion/tracking';
import { Reconstructor } from '../src/motion/reconstruct';
import { frameIndex,playbackTime,samplePose } from '../src/motion/player';
import { exportMotion,importMotion } from '../src/motion/serialization';
import { detection,fixtureClip,lm } from './fixtures';
describe('coordinate spaces',()=>{
  it('preserves a right-handed metric coordinate transform',()=>{expect(cameraToAvatar(lm(1,2,3)).toArray()).toEqual([1,-2,-3]);expect(cameraToAvatar(lm(1,0,0)).cross(cameraToAvatar(lm(0,1,0))).toArray()).toEqual([0,0,-1]);});
  it('centers shoulders and fixes their span',()=>{const n=normalizeBody(detection().bodyWorld)!;expect(n.points[11]!.distanceTo(n.points[12]!)).toBeCloseTo(.38);expect(n.points[11]!.clone().add(n.points[12]!).multiplyScalar(.5).toArray()).toEqual([0,1.3,0]);});
  it('anchors hand-local world coordinates to a wrist, independent of hand origin',()=>{const points=detection().hands[0].world;const shifted=points.map(p=>({...p,x:p.x+9,y:p.y-4,z:p.z+3}));const wrist=new Vector3(.2,1.4,.3);const a=alignHand(points,wrist)!,b=alignHand(shifted,wrist)!;expect(a[0].distanceTo(wrist)).toBe(0);a.forEach((p,i)=>expect(p.distanceTo(b[i])).toBeLessThan(1e-12));});
  it('rejects non-finite and degenerate landmarks',()=>{expect(normalizeBody([])).toBeNull();expect(normalizeBody(Array(33).fill(lm(0,0)))).toBeNull();expect(alignHand([lm(NaN,0)],new Vector3())).toBeNull();});
});
describe('hand identity and mirroring',()=>{
  it('associates anatomical wrists even if result order and labels disagree',()=>{const f=detection();f.hands.reverse();f.hands[0].label='Left';f.hands[1].label='Right';expect(assignHands(f).assignment).toEqual({left:1,right:0});});
  it('unmirrors pixels before inference and mirrors display coordinates back',()=>{const p=lm(.2,.4,.1);expect(unmirrorImage(p).x).toBe(.8);expect(unmirrorImage(unmirrorImage(p)).x).toBeCloseTo(p.x);expect(unmirrorImage(p).z).toBe(p.z);});
  it('does not give both wrists the same hand',()=>{const f=detection();f.hands=f.hands.slice(0,1);expect(assignHands(f).assignment).toEqual({left:0});});
  it('withholds ambiguous crossing hands',()=>{const f=detection();f.body[15]=lm(.5,.6);f.body[16]=lm(.5,.6);f.hands.forEach(h=>{h.image[0]=lm(.5,.6);h.label='Unknown';});expect(assignHands(f).assignment).toEqual({});});
  it('rejects low confidence hands and missing wrist anchors',()=>{const f=detection();f.hands[0].score=.1;f.body[16].visibility=.1;expect(assignHands(f).assignment).toEqual({});});
});
describe('constrained anatomical rig',()=>{
  it('preserves both bone lengths and bounds elbow angles over a target grid',()=>{
    for(let i=0;i<40;i++){const shoulder=new Vector3(.19,1.3,0),target=new Vector3(Math.sin(i)*.8,.2+Math.cos(i)*1.5,Math.sin(i*.5));const arm=solveArm(shoulder,target,new Vector3(.4,1,-.2));expect(arm.elbow.distanceTo(shoulder)).toBeCloseTo(LENGTHS.upper,10);expect(arm.wrist.distanceTo(arm.elbow)).toBeCloseTo(LENGTHS.lower,10);expect(arm.flexion).toBeGreaterThanOrEqual(rad(5)-1e-10);expect(arm.flexion).toBeLessThanOrEqual(rad(150)+1e-10);expect(new Vector3(0,LENGTHS.upper,0).applyQuaternion(arm.upperQ).add(shoulder).distanceTo(arm.elbow)).toBeLessThan(1e-8);}
  });
  it('uses temporal bend direction at a straight-arm singularity',()=>{const a=solveArm(new Vector3(),new Vector3(0,-.5,0),new Vector3(0,-.2,0),new Vector3(1,0,0));expect(a.unstable).toBe(true);expect(a.elbow.x).toBeGreaterThan(0);});
  it('bounds wrist swing and twist without losing quaternion normalization',()=>{for(let i=0;i<50;i++){const result=boundWrist(new Quaternion().setFromAxisAngle(new Vector3(Math.sin(i),Math.cos(i),.5).normalize(),i/5));const second=boundWrist(result.rotation);expect(result.rotation.length()).toBeCloseTo(1);expect(result.swing).toBeLessThanOrEqual(rad(85)+1e-10);expect(Math.abs(result.twist)).toBeLessThanOrEqual(rad(160));expect(second.correction).toBeLessThan(1e-6);}});
  it('produces articulated rotations with finite unit quaternions',()=>{const f=new Reconstructor().reconstruct(detection());expect(f.pose.quality.leftState).toBe('tracked');expect(Object.keys(f.pose.rotations)).toHaveLength(38);for(const v of Object.values(f.pose.rotations)){expect(v.every(Number.isFinite)).toBe(true);expect(Math.hypot(...v)).toBeCloseTo(1);}});
  it('holds missing hands briefly at zero confidence then removes them',()=>{const r=new Reconstructor();r.reconstruct(detection());const lost=detection(100);lost.hands=[];const held=r.reconstruct(lost);expect(held.pose.quality.leftState).toBe('held');expect(held.pose.quality.left).toBe(0);lost.timestamp=350;const missing=r.reconstruct(lost);expect(missing.pose.quality.leftState).toBe('missing');expect(missing.pose.quality.leftArm).toBeGreaterThan(0);});
  it('withholds all reconstruction when shoulders are missing',()=>{const f=detection();f.body=[];const result=new Reconstructor().reconstruct(f);expect(result.pose.quality.body).toBe(0);expect(result.pose.quality.leftState).toBe('missing');});
});
describe('temporal sampling and synchronized clock',()=>{
  it('uses SLERP between adjacent valid frames',()=>{const clip=fixtureClip();clip.frames[0].pose.rotations.head=[0,0,0,1];clip.frames[1].pose.rotations.head=qa(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2));expect(q(samplePose(clip,.05).rotations.head).angleTo(new Quaternion())).toBeCloseTo(Math.PI/4);});
  it('never interpolates fingers across a missing endpoint',()=>{const clip=fixtureClip();clip.frames[1].pose.quality.leftState='missing';clip.frames[1].pose.rotations['left.index.0']=[1,0,0,0];expect(samplePose(clip,.05).rotations['left.index.0']).toEqual(clip.frames[0].pose.rotations['left.index.0']);});
  it('finds exact timestamps and clamps both ends',()=>{const clip=fixtureClip();expect(frameIndex(clip,-1)).toBe(0);expect(frameIndex(clip,.1)).toBe(1);expect(frameIndex(clip,9)).toBe(2);});
  it('uses video time for playing, paused and scrubbed states',()=>{const video={currentTime:.3};expect(playbackTime(video,8)).toBe(.3);video.currentTime=.9;expect(playbackTime(video,0)).toBe(.9);expect(playbackTime(null,.6)).toBe(.6);});
  it('applies saved manual correction to playback',()=>{const clip=fixtureClip();clip.edits=[{frame:0,side:'left',degrees:[20,0,0]}];expect(q(samplePose(clip,0).rotations['left.wrist']).angleTo(new Quaternion())).toBeCloseTo(rad(20));});
});
describe('portable motion JSON',()=>{
  it('round-trips detections, timestamps, rotations and correction metadata',()=>{const clip=fixtureClip();clip.edits=[{frame:1,side:'right',degrees:[2,3,4]}];expect(importMotion(exportMotion(clip))).toEqual(clip);});
  it('rejects unsupported schemas, incomplete rigs, nonunit quaternions and unordered times',()=>{for(const mutation of [(c:MotionClip)=>{c.version=2 as 1;},(c:MotionClip)=>{delete c.frames[0].pose.rotations.head;},(c:MotionClip)=>{c.frames[0].pose.rotations.head=[0,0,0,9];},(c:MotionClip)=>{c.frames[1].timestamp=0;},(c:MotionClip)=>{c.frames[0].body[0].x=NaN;}]){const clip=fixtureClip();mutation(clip);expect(()=>importMotion(exportMotion(clip))).toThrow();}});
});
import type { MotionClip } from '../src/motion/types';
