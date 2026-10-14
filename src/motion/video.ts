import { seekPresentation, identicalPixels } from './decodedFrame';
import { cadence,type ExtractionMeasurements } from './timing';
import type { LandmarkDetector } from './detector';
import { appearanceCut } from './sceneCut';
import { reconstructTemporalAsync } from './temporalReconstruction';
import type { TemporalMotion } from './types';
import { Reconstructor } from './reconstruct';
import { SPACES } from './types';
import { pipelineInfo } from './pipeline';
import type { MotionClip } from './types';
export type Progress={phase:string;done:number;total:number};
export function waitEvent(target: HTMLVideoElement,event: string,signal: AbortSignal,timeout=15000) {
  return new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{ clearTimeout(timer);target.removeEventListener(event,success);target.removeEventListener('error',failure);signal.removeEventListener('abort',abort); };
    const success=()=>{cleanup();resolve();};
    const failure=()=>{cleanup();reject(new Error('The browser could not decode this video. Try H.264 MP4 or VP8/VP9 WebM.'));};
    const abort=()=>{cleanup();reject(new DOMException('Processing canceled','AbortError'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error(`Video ${event} timed out.`));},timeout);
    target.addEventListener(event,success,{once:true});target.addEventListener('error',failure,{once:true});signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
  });
}
export async function seekDecoded(video: HTMLVideoElement,seconds: number,signal: AbortSignal) {
  signal.throwIfAborted();
  if (Math.abs(video.currentTime-seconds)>0.00001) { const ready=waitEvent(video,'seeked',signal);video.currentTime=seconds;await ready; }
  if (video.readyState<2) await waitEvent(video,'loadeddata',signal);
}
export async function processVideo(file: File,detector: LandmarkDetector,options:{mirrored:boolean;sampleHz:number;signal:AbortSignal;progress:(p:Progress)=>void;maxDuration?:number;allowHandOnly?:boolean;sampleDecodedFrames?:boolean;durationHint?:number;maxDimension?:number;measurements?:(m:ExtractionMeasurements)=>void;onTemporal?:(motion:TemporalMotion)=>void;onFrame?:(frame:MotionClip['frames'][number],report:ExtractionMeasurements)=>void}):Promise<MotionClip> {
  const {signal,progress,sampleHz,mirrored}=options;
  const url=URL.createObjectURL(file),video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.preload='auto';
  const onAbort=()=>detector.close();signal.addEventListener('abort',onAbort,{once:true});
  let stage='Video decode failure';
  const started=performance.now(),report:ExtractionMeasurements={requestedHz:sampleHz,maxDimension:options.maxDimension??960,requests:0,observations:0,duplicateDecodedFrames:0,unconfirmedFrames:0,inferenceMs:0,elapsedMs:0,inferenceFps:null,analysisFps:null,cadence:cadence([]),timestampMethod:'decoded-presentation-time',backend:detector.id};
  try {
    signal.throwIfAborted();
    const loaded=waitEvent(video,'loadeddata',signal);video.src=url;video.load();await loaded;
    if(!Number.isFinite(video.duration)){await seekDecoded(video,1e7,signal);await seekDecoded(video,0,signal);}
    const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:options.durationHint;
    if (!duration || !Number.isFinite(duration) || duration<=0 || duration>(options.maxDuration??120)+(options.durationHint? .5:0)) throw new Error(`Use a video between 0 and ${options.maxDuration??120} seconds.`);
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video dimensions unavailable. Unsupported codec.');
    progress({phase:'Loading pose & hand models',done:0,total:0});
    stage='Model initialization failure';
    await detector.initialize();signal.throwIfAborted();
    stage='Inference failure';
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,(options.maxDimension??960)/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const ctx=canvas.getContext('2d');if (!ctx) throw new Error('Canvas 2D is unavailable.');
    // 0.3.0 hand-region crops are cut from a sharper copy of the same decoded frame when the source is larger
    // than the analysis canvas. The full-frame pose/hand pass keeps the analysis canvas exactly as in 0.2.0.
    const regions=detector.handRegions,detailScale=regions?Math.min(1,regions.cropSourceMaxDimension/Math.max(video.videoWidth,video.videoHeight)):0;
    const detailCanvas=regions&&detailScale>scale+1e-9?document.createElement('canvas'):undefined;
    if(detailCanvas){detailCanvas.width=Math.round(video.videoWidth*detailScale);detailCanvas.height=Math.round(video.videoHeight*detailScale);}
    const detailContext=detailCanvas?.getContext('2d');if(detailCanvas&&!detailContext)throw new Error('Canvas 2D is unavailable.');
    const cutCanvas=document.createElement('canvas');cutCanvas.width=16;cutCanvas.height=9;
    const cutContext=cutCanvas.getContext('2d',{willReadFrequently:true});let previousThumbnail:Uint8ClampedArray|undefined;
    const reconstruction=new Reconstructor();
    const total=Math.ceil(duration*sampleHz);
    const frames:MotionClip['frames']=[];
    const decodedTimes:number[]=[];let origin:number|undefined,lastDecoded=-Infinity,previousPixels:Uint8ClampedArray|undefined;
    for(let i=0;i<total;i++) {
      signal.throwIfAborted();report.requests++;
      const target=Math.min(i/sampleHz,Math.max(0,duration-.001));
      let time=target;
      if(options.sampleDecodedFrames){
        const decoded=await seekPresentation(video,target,signal);
        if(decoded!==undefined){
          if(decoded<=lastDecoded+1e-6){report.duplicateDecodedFrames++;progress({phase:'Sampling decoded frames',done:i+1,total});continue;}
          time=decoded;lastDecoded=decoded;
        }else if(typeof video.requestVideoFrameCallback==='function'){report.unconfirmedFrames++;progress({phase:'Waiting for distinct decoded frames',done:i+1,total});continue;}
        else{report.timestampMethod='requested-time-unverified';report.unconfirmedFrames++;}
      }else{await seekDecoded(video,target,signal);report.timestampMethod='requested-time-unverified';}
      ctx.setTransform(mirrored?-1:1,0,0,1,mirrored?canvas.width:0,0);ctx.drawImage(video,0,0,canvas.width,canvas.height);
      if(options.sampleDecodedFrames&&typeof video.requestVideoFrameCallback!=='function'){
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        if(identicalPixels(previousPixels,pixels)){report.duplicateDecodedFrames++;progress({phase:'Sampling decoded frames',done:i+1,total});continue;}previousPixels=pixels;
      }
      if(detailCanvas&&detailContext){detailContext.setTransform(mirrored?-1:1,0,0,1,mirrored?detailCanvas.width:0,0);detailContext.drawImage(video,0,0,detailCanvas.width,detailCanvas.height);}
      origin??=time;const inferenceStarted=performance.now();
      const detection=await (detailCanvas?detector.detect(canvas,(time-origin)*1000,detailCanvas):detector.detect(canvas,(time-origin)*1000));
      report.inferenceMs+=performance.now()-inferenceStarted;
      cutContext?.drawImage(canvas,0,0,16,9);
      const thumbnail=cutContext?.getImageData(0,0,16,9).data;
      const cut=thumbnail&&appearanceCut(previousThumbnail,thumbnail);previousThumbnail=thumbnail;
      const frame=reconstruction.reconstruct(cut?{...detection,discontinuity:'cut'}:detection);frames.push(frame);decodedTimes.push(time);
      report.observations=frames.length;report.elapsedMs=performance.now()-started;report.cadence=cadence(decodedTimes);report.backend=detector.id;
      report.inferenceFps=report.inferenceMs?frames.length*1000/report.inferenceMs:null;report.analysisFps=report.elapsedMs?frames.length*1000/report.elapsedMs:null;
      options.onFrame?.(frame,{...report});options.measurements?.({...report});
      progress({phase:'Extracting & reconstructing',done:i+1,total});
    }
    report.elapsedMs=performance.now()-started;report.analysisFps=report.elapsedMs?frames.length*1000/report.elapsedMs:null;options.measurements?.({...report});
    if(!frames.length)throw new Error('No distinct decoded frames were observed. Try an H.264 MP4 or a current browser with video-frame callbacks.');
    if (!options.allowHandOnly && !frames.some(f=>f.pose.quality.body>0)) throw new Error('No reliable upper-body pose was detected. Keep one signer, both shoulders and hands visible. No animation was generated.');
    const clip:MotionClip={schema:'signlingo.motion',version:1,language:'ksl',pipeline:pipelineInfo(detector.id,detector.handRegions),source:{name:file.name,size:file.size,duration:Math.max(.001,duration-(origin??0)),timeOffset:origin??0,width:video.videoWidth,height:video.videoHeight,mirrored,sampleHz},spaces:SPACES,nonmanual:{head:'Approximate nose/ear orientation; not facial grammar.',face:'not-estimated',linguisticValidation:'not-performed'},frames,edits:[]};
    if(options.onTemporal){stage='Temporal reconstruction failure';options.onTemporal(await reconstructTemporalAsync(clip,{signal,progress}));}
    signal.throwIfAborted();
    return clip;
  } catch(error) {
    if(signal.aborted || (error instanceof Error && error.name==='AbortError'))throw error;
    throw new Error(`${stage}: ${error instanceof Error?error.message:String(error)}`);
  } finally { detector.close();signal.removeEventListener('abort',onAbort);video.removeAttribute('src');video.load();URL.revokeObjectURL(url); }
}
