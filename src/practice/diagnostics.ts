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
  if(!shoulders)reasons.push('손의 상대 방향과 위치를 계산하려면 어깨가 안정적으로 인식되어야 합니다. 손 모양은 별도로 분석할 수 있습니다.');
  let available=0;const states={left:'누락 / 불확실',right:'누락 / 불확실'};
  for(const side of SIDES){
    const hand=feature.hands[side];
    if(hand?.shape){available++;states[side]='정상 추적';}else reasons.push(`${side==='left'?'왼손':'오른손'}: 손 모양 분석에는 신뢰할 수 있는 좌우 구분과 모든 손가락 마디가 필요합니다.`);
    if(hand?.palm)available++;else reasons.push(`${side==='left'?'왼손':'오른손'}: 손바닥 방향 분석에는 신뢰할 수 있는 손바닥과 3D 어깨 정보가 필요합니다.`);
    if(hand?.position||hand?.position2D)available++;else reasons.push(`${side==='left'?'왼손':'오른손'}: 위치 분석에는 신뢰할 수 있는 어깨와 손목 정보가 필요합니다.`);
    if(hand?.face||hand?.face2D)available++;else reasons.push(`${side==='left'?'왼손':'오른손'}: 얼굴 기준 위치 분석에는 어깨·손목·코 정보가 필요합니다.`);
    if(!hand?.position&&hand?.position2D)reasons.push(`${side==='left'?'왼손':'오른손'}: 영상 평면의 2D 위치만 분석 가능하며 깊이 추정은 불확실합니다.`);
    if(hand?.identity==='label')reasons.push(`${side==='left'?'왼손':'오른손'}: 손만으로 구분한 결과입니다. 실제 좌우를 확인하세요.`);
  }
  return {body:shoulders?'상체 추적 중 (골반 불필요)':'누락 / 불확실',...states,coverage:available/8,reasons};
}
export function assertTracking(frames:MotionFrame[]) {
  // Keep partial attempts: missing fingers must not discard observed wrist
  // motion. Each comparison metric still enforces its own 65% coverage gate.
  const tracked=frames.filter(f=>Object.values(frameFeature(f,0).hands).some(h=>h.shape||h.palm||h.position||h.position2D)).length;
  if(frames.length<3)throw new Error('분석된 프레임이 부족합니다. 더 긴 수어 영상을 촬영하거나 휴대폰 영상 분석을 이용하세요.');
  if(tracked<3||tracked/frames.length<.2)throw new Error('AI 분석은 완료되었지만 안정적인 추적 프레임이 3개 미만이거나 관측률이 20% 미만입니다. 조명과 촬영 구도를 조정하거나 휴대폰 영상을 분석해 주세요.');
}
export function attemptTracking(clip:Parameters<typeof features>[0]) {
  const fs=features(clip);return {frames:fs.length,left:fs.filter(f=>f.hands.left?.shape).length/fs.length,right:fs.filter(f=>f.hands.right?.shape).length/fs.length};
}
