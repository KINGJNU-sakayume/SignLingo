// Measurements are kept outside schema-1 MotionClip, whose sampleHz is a request.
export type Cadence = {samples:number;fps:number|null;duplicateTimes:number;irregularIntervals:number;largeGaps:number;maxGapMs:number;callbackSkips:number};
export function cadence(times:number[],presented:number[]=[]):Cadence {
  const gaps=times.slice(1).map((t,i)=>t-times[i]),positive=gaps.filter(d=>d>1e-6),ordered=[...positive].sort((a,b)=>a-b);
  const middle=ordered[Math.floor(ordered.length/2)]??0;
  return {samples:times.length,fps:positive.length&&times.at(-1)!>times[0]?positive.length/(times.at(-1)!-times[0]):null,
    duplicateTimes:gaps.filter(d=>d<=1e-6).length,irregularIntervals:positive.filter(d=>Math.abs(d-middle)>Math.max(.002,middle*.25)).length,
    largeGaps:positive.filter(d=>d>middle*1.75).length,maxGapMs:positive.length?Math.max(...positive)*1000:0,
    callbackSkips:presented.slice(1).reduce((sum,n,i)=>sum+Math.max(0,n-presented[i]-1),0)};
}
export type CaptureMeasurements = {
  requestedCameraFps:number;reportedTrackFps:number|null;delivery:Cadence;
  deliveryMethod:'video-frame-callback'|'video-clock-poll';encodedRecordingFps:null;
  duration:number;width:number;height:number;
};
export type ExtractionMeasurements = {
  requestedHz:number;maxDimension:number;requests:number;observations:number;
  duplicateDecodedFrames:number;unconfirmedFrames:number;inferenceMs:number;elapsedMs:number;
  inferenceFps:number|null;analysisFps:number|null;cadence:Cadence;
  timestampMethod:'decoded-presentation-time'|'requested-time-unverified';backend:string;
};
