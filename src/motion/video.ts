import type { LandmarkDetector } from './detector';
import { Reconstructor } from './reconstruct';
import { MODELS, PIPELINE_VERSION, SPACES } from './types';
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
export async function processVideo(file: File,detector: LandmarkDetector,options:{mirrored:boolean;sampleHz:number;signal:AbortSignal;progress:(p:Progress)=>void}):Promise<MotionClip> {
  const {signal,progress,sampleHz,mirrored}=options;
  const url=URL.createObjectURL(file),video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.preload='auto';
  const onAbort=()=>detector.close();signal.addEventListener('abort',onAbort,{once:true});
  try {
    const loaded=waitEvent(video,'loadeddata',signal);video.src=url;video.load();await loaded;
    if (!Number.isFinite(video.duration) || video.duration<=0 || video.duration>120) throw new Error('Use a video between 0 and 120 seconds for this memory-bounded PoC.');
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video dimensions unavailable. Unsupported codec.');
    progress({phase:'Loading pose & hand models',done:0,total:0});
    await detector.initialize();signal.throwIfAborted();
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const ctx=canvas.getContext('2d');if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const reconstruction=new Reconstructor();
    const total=Math.ceil(video.duration*sampleHz);
    const frames:MotionClip['frames']=[];
    for(let i=0;i<total;i++) {
      signal.throwIfAborted();
      const time=Math.min(i/sampleHz,Math.max(0,video.duration-0.001));
      await seekDecoded(video,time,signal);
      ctx.setTransform(mirrored?-1:1,0,0,1,mirrored?canvas.width:0,0);
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const bitmap=await createImageBitmap(canvas);
      const detection=await detector.detect(bitmap,time*1000);
      frames.push(reconstruction.reconstruct(detection));
      progress({phase:'Extracting & reconstructing',done:i+1,total});
    }
    if (!frames.some(f=>f.pose.quality.body>0)) throw new Error('No reliable upper-body pose was detected. Keep one signer, both shoulders and hands visible. No animation was generated.');
    return {schema:'signlingo.motion',version:1,language:'ksl',pipeline:{version:PIPELINE_VERSION,detector:detector.id,models:MODELS},source:{name:file.name,size:file.size,duration:video.duration,width:video.videoWidth,height:video.videoHeight,mirrored,sampleHz},spaces:SPACES,nonmanual:{head:'Approximate nose/ear orientation; not facial grammar.',face:'not-estimated',linguisticValidation:'not-performed'},frames,edits:[]};
  } finally { detector.close();signal.removeEventListener('abort',onAbort);video.removeAttribute('src');video.load();URL.revokeObjectURL(url); }
}
