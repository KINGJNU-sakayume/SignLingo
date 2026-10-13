import { describe,it,expect } from 'vitest';
import { practiceClip } from './practice-fixtures';
import { frameFeature } from '../src/practice/features';
import { assertTracking,inspectTracking } from '../src/practice/diagnostics';
import { compareMotion } from '../src/practice/compare';
import { Reconstructor } from '../src/motion/reconstruct';
const cropped=()=>{const clip=practiceClip();for(const f of clip.frames)for(const i of [23,24]){f.body[i].visibility=.1;f.bodyWorld[i].visibility=.1;}return clip;};
describe('per-component mobile evidence',()=>{
  it('retains handshape and an explicit shoulder frame with missing hips',()=>{
    const clip=cropped(),f=frameFeature(clip.frames[0],0),d=inspectTracking(clip.frames[0]);
    expect(f.hands.left?.shape).toHaveLength(15);expect(f.hands.left?.basis).toBe('upper-body');expect(f.hands.left?.palm).toBeDefined();expect(f.hands.left?.position).toBeDefined();expect(f.hands.left?.face).toBeDefined();
    expect(d).toMatchObject({body:'상체 추적 중 (골반 불필요)',left:'정상 추적',right:'정상 추적',coverage:1});expect(d.reasons).toEqual([]);expect(()=>assertTracking(clip.frames)).not.toThrow();
  });
  it('compares hip-visible references against cropped learners in the same frame',()=>{
    const result=compareMotion(practiceClip(),cropped());expect(result.metrics.filter(m=>m.component==='handshape').every(m=>m.value!==null)).toBe(true);
    expect(result.metrics.filter(m=>m.component!=='direction').every(m=>m.value!==null&&m.value<1e-5)).toBe(true);expect(result.evidence).toBe('sufficient');expect(result.feedback.some(f=>f.kind==='observed')).toBe(false);
    expect(compareMotion(cropped(),cropped()).metrics.find(m=>m.component==='palm')?.value).toBeLessThan(.001);
  });
  it('retains raw hand-only evidence without inventing an avatar or body frame',()=>{
    const raw=practiceClip().frames[0];raw.body=[];raw.bodyWorld=[];
    const frame=new Reconstructor().reconstruct(raw),f=frameFeature(frame,0);
    expect(frame.pose.quality.leftState).toBe('missing');expect(f.hands.left).toMatchObject({basis:'none',identity:'label'});expect(f.hands.left?.shape).toHaveLength(15);expect(f.hands.left?.palm).toBeUndefined();
    frame.hands[0].score=.8;expect(frameFeature(frame,0).hands.left).toBeUndefined();
  });
  it('does not assign crossing/ambiguous hands from labels when pose exists',()=>{
    const f=practiceClip().frames[0];f.assignment={};expect(frameFeature(f,0).hands.left?.shape).toBeUndefined();expect(frameFeature(f,0).hands.left?.identity).toBe('pose');
  });
  it('withholds only measurements whose wrist/nose references are missing',()=>{
    const f=practiceClip().frames[0];f.bodyWorld[0].visibility=.1;expect(frameFeature(f,0).hands.left?.face).toBeUndefined();expect(frameFeature(f,0).hands.left?.position).toBeDefined();
    f.bodyWorld[15].visibility=.1;expect(frameFeature(f,0).hands.left?.position).toBeUndefined();expect(frameFeature(f,0).hands.left?.shape).toHaveLength(15);
  });
  it('keeps reliable position comparison when finger tracking is missing',()=>{
    const clip=practiceClip();clip.frames.forEach(f=>{f.hands=[];f.assignment={};});expect(()=>assertTracking(clip.frames)).not.toThrow();
    const metrics=compareMotion(practiceClip(),clip).metrics;
    expect(metrics.filter(m=>m.component==='handshape').every(m=>m.value===null)).toBe(true);
    expect(metrics.filter(m=>m.component==='position').every(m=>m.value!==null)).toBe(true);
    expect(inspectTracking(clip.frames[10]).coverage).toBe(.5);
  });
  it('rejects zero and very low component coverage without calling it a successful attempt',()=>{
    const clip=practiceClip();clip.frames.forEach(f=>{f.hands=[];f.assignment={};f.body=[];f.bodyWorld=[];});expect(()=>assertTracking(clip.frames)).toThrow('AI 분석은 완료되었지만');
    clip.frames.splice(0,3,...practiceClip().frames.slice(0,3));expect(()=>assertTracking(clip.frames)).toThrow('20%');
    expect(inspectTracking(clip.frames[10]).coverage).toBe(0);
  });
});
