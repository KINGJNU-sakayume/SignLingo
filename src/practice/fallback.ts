import { MediaPipeDetector, type LandmarkDetector } from '../motion/detector';
import { processVideo, type Progress } from '../motion/video';
import type { ExtractionMeasurements } from '../motion/timing';
import type { MotionFrame } from '../motion/types';
import { assertTracking } from './diagnostics';
// Native phone capture avoids MediaRecorder/live CPU requirements. The same
// local extraction, reconstruction and comparison contracts are retained.
export async function processPracticeVideo(file:File,options:{mirrored:boolean;signal:AbortSignal;progress:(p:Progress)=>void;sampleHz?:15|30;maxDimension?:640|960;durationHint?:number;measurements?:(m:ExtractionMeasurements)=>void;onFrame?:(f:MotionFrame,m:ExtractionMeasurements)=>void},detector:LandmarkDetector=new MediaPipeDetector()) {
  if(file.size>100*1024*1024)throw new Error('Use a phone video smaller than 100 MB.');
  const clip=await processVideo(file,detector,{...options,sampleHz:options.sampleHz??30,maxDuration:20,allowHandOnly:true,sampleDecodedFrames:true});
  assertTracking(clip.frames);
  return clip;
}
