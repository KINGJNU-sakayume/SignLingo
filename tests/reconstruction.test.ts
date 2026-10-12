import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Object3D } from 'three';
import { alignHand, eulerQuat, q, rad, solveArm } from '../src/motion/math';
import { palmFrame, reconstructFingers } from '../src/motion/hand';
import { Reconstructor } from '../src/motion/reconstruct';
import { LegacyReconstructor } from '../src/motion/legacy/reconstruct';
import { forwardHand } from '../src/motion/rig';
import { inspectClip, inspectFrame, pairedDirectionError } from '../src/motion/diagnostics';
import { reconstructClip } from '../src/motion/comparison';
import { fingerAblation } from '../src/motion/ablation';
import { samplePose } from '../src/motion/player';
import { exportMotion, importMotion } from '../src/motion/serialization';
import { assignHands } from '../src/motion/tracking';
import { FINGERS, SIDES } from '../src/motion/types';
import { detection, fixtureClip, lm } from './fixtures';
import { articulatedDetection } from './articulation';
const errors = (frame: ReturnType<Reconstructor['reconstruct']>) => SIDES.flatMap(s=>inspectFrame(frame).hands[s]?.segments.map(x=>x.directionDegrees)??[]);

describe('direction reconstruction regressions',()=>{
  it('exposes the baseline parent-frame/clamping error with independent analytic segments',()=>{
    const source=articulatedDetection();
    const before=errors(new LegacyReconstructor().reconstruct(source));
    const after=errors(new Reconstructor().reconstruct(source));
    expect(before.length).toBe(30);expect(after.length).toBe(30);
    expect(Math.max(...before)).toBeGreaterThan(15);
    expect(Math.max(...after)).toBeLessThan(.00001);
  });
  it('isolates the source-parent roll mismatch even with no joint limits',()=>{
    const source=articulatedDetection({spread:.6});
    const hp=alignHand(source.hands[0].world,new Vector3())!;
    const palm=palmFrame(hp,'left')!.rotation;
    const actualParent=palm.clone();let estimatedParent=palm.clone();
    const residuals:number[]=[];
    for(let j=0;j<3;j++){
      const direction=hp[6+j].clone().sub(hp[5+j]).normalize();
      const local=direction.clone().applyQuaternion(estimatedParent.clone().invert());
      actualParent.multiply(eulerQuat(Math.atan2(local.z,local.y),0,-Math.atan2(local.x,Math.hypot(local.y,local.z))));
      residuals.push(new Vector3(0,1,0).applyQuaternion(actualParent).angleTo(direction));
      estimatedParent=palm.clone().multiply(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.clone().applyQuaternion(palm.clone().invert())));
    }
    expect(residuals[0]).toBeLessThan(1e-7);
    expect(Math.max(...residuals.slice(1))).toBeGreaterThan(rad(5));
  });
  it('recovers relative flexion, not cumulative flexion, for both hands',()=>{
    const f=new Reconstructor().reconstruct(articulatedDetection({flex:[.6,.8,.4],spread:0}));
    for(const side of SIDES)for(let j=0;j<3;j++)expect(q(f.pose.rotations[`${side}.index.${j}`]).angleTo(eulerQuat([.6,.8,.4][j],0,0))).toBeLessThan(1e-6);
  });
  it('matches a real Object3D hierarchy under simultaneous flexion and abduction',()=>{
    const source=articulatedDetection({spread:.6});const hp=alignHand(source.hands[0].world,new Vector3())!;
    const palm=palmFrame(hp,'left')!.rotation;
    const fingers=reconstructFingers(hp,palm,'left')!;
    const root=new Object3D();root.quaternion.copy(palm);
    for(let f=0;f<5;f++){
      let parent=root;
      for(let j=0;j<3;j++){
        const joint=new Object3D();joint.quaternion.copy(q(fingers.rotations[`left.${FINGERS[f]}.${j}`]));parent.add(joint);root.updateMatrixWorld(true);
        const world=joint.getWorldQuaternion(new Quaternion());const actual=new Vector3(0,1,0).applyQuaternion(world);
        expect(actual.angleTo(hp[2+f*4+j].clone().sub(hp[1+f*4+j]))).toBeLessThan(1e-6);parent=joint;
      }
    }
  });
  it('preserves mirrored hand shapes, including opposition and unusual valid MCP extension',()=>{
    const source=articulatedDetection({thumb:true,flex:[-.4,.9,.5],spread:.6});
    const frame=new Reconstructor().reconstruct(source);
    expect(Math.max(...errors(frame))).toBeLessThan(.00001);
    const left=forwardHand(frame.pose,'left'),right=forwardHand(frame.pose,'right');
    left.segments.forEach((segment,i)=>{const mirrored=segment.direction.clone();mirrored.x*=-1;expect(mirrored.distanceTo(right.segments[i].direction)).toBeLessThan(1e-8);});
    expect(frame.corrections.filter(c=>c.kind.endsWith('radians'))).toHaveLength(0);
  });
  it('retains legitimate palm rotations through 180 degrees and warns on sudden flips',()=>{
    const r=new Reconstructor();r.reconstruct(articulatedDetection());
    const next=r.reconstruct(articulatedDetection({timestamp:33,palm:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI)}));
    expect(Math.max(...errors(next))).toBeLessThan(.00001);
    expect(next.warnings.some(w=>w.includes('palm-world: sudden rotation'))).toBe(true);
    for(const side of SIDES)expect(inspectFrame(next).hands[side]!.palmDegrees).toBeLessThan(.00001);
  });
  it('withholds nearly collinear palms and zero-length phalanges instead of fabricating frames',()=>{
    const source=detection();source.hands[0].world[5]=lm(0,-.05,1e-8);source.hands[0].world[17]=lm(0,-.09,0);
    expect(new Reconstructor().reconstruct(source).pose.quality.leftState).toBe('missing');
    const broken=detection();broken.hands[0].world[6]={...broken.hands[0].world[5]};
    expect(new Reconstructor().reconstruct(broken).pose.quality.leftState).toBe('missing');
  });
  it('does not smooth a supported brief articulation into the wrong source directions',()=>{
    const r=new Reconstructor();r.reconstruct(articulatedDetection({flex:[0,0,0]}));
    const f=r.reconstruct(articulatedDetection({timestamp:33,flex:[1,1,.8]}));
    expect(Math.max(...errors(f))).toBeLessThan(.00001);expect(f.warnings.some(w=>w.includes('sudden rotation'))).toBe(true);
  });
});
describe('arm ambiguity and identity',()=>{
  it('has a finite fallback even when direction, measured pole and prior pole are parallel',()=>{
    const arm=solveArm(new Vector3(),new Vector3(.53,0,0),new Vector3(.2,0,0),new Vector3(1,0,0));
    expect(arm.pole.length()).toBeCloseTo(1);expect(arm.upperQ.length()).toBeCloseTo(1);expect(arm.elbow.toArray().every(Number.isFinite)).toBe(true);
  });
  it('prevents noisy near-extension elbow reversals without rejecting a supported pole reversal',()=>{
    const shoulder=new Vector3(),wrist=new Vector3(0,-.53,0);
    const near=solveArm(shoulder,wrist,new Vector3(-.012,-.25,0),new Vector3(1,0,0));
    expect(near.pole.x).toBeGreaterThan(.99);expect(near.unstable).toBe(true);
    const clear=solveArm(shoulder,new Vector3(0,-.35,0),new Vector3(-.20,-.2,0),new Vector3(1,0,0));
    expect(clear.pole.x).toBeLessThan(-.99);expect(clear.unstable).toBe(false);
  });
  it('allows overhead and behind-torso wrists without an elevation or front-of-body clamp',()=>{
    const source=detection();source.bodyWorld[15]=lm(.195,-1.025,.1);source.bodyWorld[13]=lm(.3,-.8,.1);
    const f=new Reconstructor().reconstruct(source);
    expect(f.corrections.some(c=>c.kind.includes('elevation'))).toBe(false);
    expect(forwardHand(f.pose,'left').wrist.y).toBeGreaterThan(1.3);
    expect(forwardHand(f.pose,'left').wrist.z).toBeLessThan(0);
  });
  it('withholds a single ambiguous hand at crossing wrists',()=>{
    const f=detection();f.hands=f.hands.slice(0,1);f.body[15]=f.body[16]=lm(.5,.6);f.hands[0].image[0]=lm(.5,.6);
    expect(assignHands(f).assignment).toEqual({});
  });
  it('does not call detector output reordering a change of identity',()=>{
    const r=new Reconstructor(),a=r.reconstruct(detection());const b=detection(33);b.hands.reverse();
    expect(inspectFrame(r.reconstruct(b),a).identityEvents).toHaveLength(0);
  });
  it('expires continuity after gaps and withholds missing hands from residual statistics',()=>{
    const r=new Reconstructor();r.reconstruct(detection());const missing=detection(1000);missing.hands=[];
    const f=r.reconstruct(missing);expect(f.pose.quality.leftState).toBe('missing');expect(inspectFrame(f).hands).toEqual({});
  });
});
describe('reproducible diagnostics',()=>{
  it('compares identical immutable detections and reports missing metrics as null',()=>{
    const clip=fixtureClip();clip.frames=clip.frames.map((f,i)=>({...f,...articulatedDetection({timestamp:i*100})}));const snapshot=JSON.stringify(clip);
    const a=reconstructClip(clip,'original'),b=reconstructClip(clip,'improved');
    const paired=pairedDirectionError(inspectClip(a),inspectClip(b));
    const ablation=fingerAblation(a);expect(ablation.segments).toBe(90);expect(ablation.unboundedOldDirectionMaxDegrees!).toBeGreaterThan(1);
    expect(paired.segments).toBe(90);expect(paired.beforeDegrees!).toBeGreaterThan(5);expect(paired.afterDegrees!).toBeLessThan(.00001);expect(JSON.stringify(clip)).toBe(snapshot);
    const missing=fixtureClip();missing.frames.forEach(f=>{f.hands=[];f.assignment={};f.pose.quality.leftState=f.pose.quality.rightState='missing';});
    expect(inspectClip(missing).summary.directionMeanDegrees).toBeNull();
  });
  it('round-trips 0.2 poses in schema 1 and does not clamp their zero manual edits',()=>{
    const clip=reconstructClip(fixtureClip(),'improved');
    clip.edits=[{frame:0,side:'left',degrees:[0,0,0]}];
    expect(importMotion(exportMotion(clip))).toEqual(clip);
    expect(q(samplePose(clip,0).rotations['left.wrist']).angleTo(q(clip.frames[0].pose.rotations['left.wrist']))).toBeLessThan(1e-7);
  });
  it('keeps fixed-rig positional error visible even when directions are exact',()=>{
    const f=new Reconstructor().reconstruct(articulatedDetection());const h=inspectFrame(f).hands.left!;
    expect(Math.max(...h.segments.map(s=>s.directionDegrees))).toBeLessThan(.00001);
    expect(Math.max(...h.segments.map(s=>s.positionMm))).toBeGreaterThan(5);
  });
});
