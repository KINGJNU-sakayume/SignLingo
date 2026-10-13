import { SIDES, type MotionFrame } from '../motion/types';
import { frameFeature, features } from './features';
import { reliableImage } from './upperBody';
export type TrackingDiagnostics = {
  model:'loading'|'ready'|'failed';backend:string;fps:number;
  body:string;left:string;right:string;coverage:number;
  reasons:string[];frame?:MotionFrame;width:number;height:number;
  attempt?:{frames:number;left:number;right:number};
};
export function inspectTracking(frame:MotionFrame) {
  const feature=frameFeature(frame,0),reasons:string[]=[];
  const shoulders=[11,12].every(i=>reliableImage(frame,i));
  if(!shoulders)reasons.push('Reliable shoulders required for relative orientation/position. Handshape can still be available.');
  let available=0;const states={left:'missing / uncertain',right:'missing / uncertain'};
  for(const side of SIDES){
    const hand=feature.hands[side];
    if(hand?.shape){available++;states[side]='tracked';}else reasons.push(`${side}: handshape needs reliable identity and all finger segments.`);
    if(hand?.palm)available++;else reasons.push(`${side}: palm orientation needs reliable measured palm and 3D shoulders.`);
    if(hand?.position||hand?.position2D)available++;else reasons.push(`${side}: position needs reliable shoulders and wrist.`);
    if(hand?.face||hand?.face2D)available++;else reasons.push(`${side}: face position needs reliable shoulders, wrist and nose.`);
    if(!hand?.position&&hand?.position2D)reasons.push(`${side}: image-plane position only; estimated depth unavailable.`);
    if(hand?.identity==='label')reasons.push(`${side}: hand-only identity uses a high-confidence model label; verify anatomical side.`);
  }
  return {body:shoulders?'upper body tracked (hips optional)':'missing / uncertain',...states,coverage:available/8,reasons};
}
export function assertTracking(frames:MotionFrame[]) {
  // Keep partial attempts: missing fingers must not discard observed wrist
  // motion. Each comparison metric still enforces its own 65% coverage gate.
  const tracked=frames.filter(f=>Object.values(frameFeature(f,0).hands).some(h=>h.shape||h.palm||h.position||h.position2D)).length;
  if(frames.length<3)throw new Error('Not enough processed frames. Record a longer sign or use the phone-video fallback.');
  if(tracked<3||tracked/frames.length<.2)throw new Error('Inference succeeded, but tracking is insufficient: fewer than three frames with supported components or under 20% observed-component coverage. Improve lighting/framing or process a phone video.');
}
export function attemptTracking(clip:Parameters<typeof features>[0]) {
  const fs=features(clip);return {frames:fs.length,left:fs.filter(f=>f.hands.left?.shape).length/fs.length,right:fs.filter(f=>f.hands.right?.shape).length/fs.length};
}
