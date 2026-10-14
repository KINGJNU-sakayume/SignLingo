/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MODELS } from './types';
import type { HandRegionSettings } from './types';
import { cleanLandmarks as clean, detectWithRegions, handsFrom, regionLandmarkerOptions } from './visionResult';
let pose: PoseLandmarker, hands: HandLandmarker;
// Optional pipeline 0.3.0 crop re-detection: a separate IMAGE-mode task, so full-frame VIDEO tracking is untouched.
let regionHands: HandLandmarker | undefined, regions: HandRegionSettings | undefined, surface: OffscreenCanvas | undefined;
self.onmessage=async (event: MessageEvent)=>{
  const {type,frame,detail,timestampMs,handRegions}=event.data;
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
      if (handRegions) {
        runtime.ModuleFactory=loader.default;
        regionHands=await HandLandmarker.createFromOptions(files,regionLandmarkerOptions(handRegions));
        regions=handRegions;surface=new OffscreenCanvas(handRegions.cropSize,handRegions.cropSize);
      }
      self.postMessage({type:'ready'});
    } else if (type==='detect') {
      try {
        const p=pose.detectForVideo(frame,timestampMs), h=hands.detectForVideo(frame,timestampMs);
        const body=clean(p.landmarks[0]??[]);
        const detected=regionHands&&regions&&surface?await detectWithRegions({body,frameHands:handsFrom(h),source:detail??frame,surface,landmarker:regionHands,settings:regions}):handsFrom(h);
        self.postMessage({type:'result',result:{timestamp:timestampMs,body,bodyWorld:clean(p.worldLandmarks[0]??[]),hands:detected}});
      } finally { frame.close();detail?.close(); }
    }
  } catch(error) { self.postMessage({type:'error',message:error instanceof Error ? error.message : String(error)}); }
};
