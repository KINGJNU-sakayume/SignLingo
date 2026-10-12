import { confidence } from '../motion/math';
import { SIDES, type MotionFrame } from '../motion/types';
import { frameFeature } from './features';
export type TrackingDiagnostics = {
  model: 'loading'|'ready'|'failed'; backend: string; fps: number;
  body: string; left: string; right: string; coverage: number;
  reasons: string[]; frame?: MotionFrame; width: number; height: number;
};
export function inspectTracking(frame:MotionFrame) {
  const feature=frameFeature(frame,0), reasons:string[]=[];
  const good=(i:number)=>confidence(frame.body[i])>=.6&&confidence(frame.bodyWorld[i])>=.6;
  const shoulders=[11,12].every(good),hips=[23,24].every(good);
  if(!shoulders)reasons.push('Shoulders missing or below 0.6 confidence: body-relative orientation and position unavailable.');
  if(!hips)reasons.push('Hips missing or below 0.6 confidence: torso position, face position and paths unavailable.');
  let available=0;
  const states={left:'missing / uncertain',right:'missing / uncertain'};
  for(const side of SIDES){
    const hand=feature.hands[side];
    if(!hand){reasons.push(`${side}: missing hand, uncertain identity, low confidence or degenerate finger geometry.`);continue;}
    states[side]='tracked';available++;
    if(hand.palm)available++;
    if(hand.position)available++;else reasons.push(`${side}: reliable torso and wrist references required for position.`);
    if(hand.face)available++;else reasons.push(`${side}: reliable nose, wrist and torso required for face position.`);
    if(hand.basis==='shoulders')reasons.push('Shoulder orientation uses camera-up: sensitive to camera tilt; not comparable to a full torso frame.');
    if(hand.identity==='label')reasons.push(`${side}: hand-only identity uses a high-confidence model label; verify anatomical side.`);
  }
  return {body:shoulders?(hips?'torso tracked':'upper body only'):'missing / uncertain',...states,coverage:available/8,reasons:[...new Set(reasons)]};
}
export function assertTracking(frames:MotionFrame[]) {
  const tracked=frames.filter(f=>Object.keys(frameFeature(f,0).hands).length>0).length;
  if(frames.length<3)throw new Error('Not enough processed frames. Record a longer sign or use the phone-video fallback.');
  if(tracked<3 || tracked/frames.length<.2)throw new Error('Inference succeeded, but tracking is insufficient: fewer than three usable hand frames or under 20% hand coverage. Improve lighting/framing or process a phone video.');
}
