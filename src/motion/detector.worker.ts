/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MODELS } from './types';
import type { Landmark } from './types';
let pose: PoseLandmarker, hands: HandLandmarker;
// Hand Tasks do not estimate per-point visibility/presence. The JS wrapper
// materializes unset proto fields as zero; do not misreport them as observations.
const clean=(points: Landmark[],hasConfidence=true)=>points.map(p=>({x:p.x,y:p.y,z:p.z,...(hasConfidence&&Number.isFinite(p.visibility)?{visibility:p.visibility}:{}),...(hasConfidence&&Number.isFinite(p.presence)?{presence:p.presence}:{})}));
self.onmessage=async (event: MessageEvent)=>{
  const {type,frame,timestampMs}=event.data;
  try {
    if (type==='init') {
      const files=await FilesetResolver.forVisionTasks(MODELS.wasm,true);
      // Tasks 1.1 clears ModuleFactory after creating a task. ES-module imports
      // are cached, so restore the exported factory before EACH task creation.
      // This avoids the second task's "ModuleFactory not set" in module workers.
      const loader=await import(/* @vite-ignore */ files.wasmLoaderPath);
      const runtime=globalThis as typeof globalThis & {ModuleFactory:unknown};
      runtime.ModuleFactory=loader.default;
      pose=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:MODELS.pose,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5});
      runtime.ModuleFactory=loader.default;
      hands=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:MODELS.hand,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:0.5,minHandPresenceConfidence:0.5,minTrackingConfidence:0.5});
      self.postMessage({type:'ready'});
    } else if (type==='detect') {
      try {
        const p=pose.detectForVideo(frame,timestampMs), h=hands.detectForVideo(frame,timestampMs);
        self.postMessage({type:'result',result:{timestamp:timestampMs,body:clean(p.landmarks[0]??[]),bodyWorld:clean(p.worldLandmarks[0]??[]),hands:h.landmarks.map((landmarks,i)=>({image:clean(landmarks,false),world:clean(h.worldLandmarks[i],false),label:h.handedness[i]?.[0]?.categoryName??'Unknown',score:h.handedness[i]?.[0]?.score??0}))}});
      } finally { frame.close(); }
    }
  } catch(error) { self.postMessage({type:'error',message:error instanceof Error ? error.message : String(error)}); }
};
