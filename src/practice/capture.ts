import { assertTracking, inspectTracking, type TrackingDiagnostics } from './diagnostics';
import { MediaPipeDetector, releaseFrame, type VisionFrame, type LandmarkDetector } from '../motion/detector';
import { Reconstructor } from '../motion/reconstruct';
import { MODELS, PIPELINE_VERSION, SPACES, type MotionClip } from '../motion/types';
export type CaptureResult = { clip: MotionClip; recording: Blob };
export type CapturePlatform = {
  camera: () => Promise<MediaStream>;
  detector: () => LandmarkDetector;
  recorder: (stream: MediaStream) => MediaRecorder;
  bitmap: (video: HTMLVideoElement, unmirror: boolean) => Promise<VisionFrame>;
  now: () => number;
  dispose?: () => void;
};
export function recordingMime(supported: (type:string)=>boolean) {
  return ['video/webm;codecs=vp8','video/webm','video/mp4'].find(supported);
}
export function stopTracks(stream?: MediaStream) { stream?.getTracks().forEach(track=>track.stop()); }
function browserPlatform():CapturePlatform {
  let canvas:HTMLCanvasElement|undefined;
  return {
  camera: () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS and a browser with getUserMedia support.');
    return navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720},frameRate:{ideal:15,max:30}},audio:false});
  },
  detector: () => new MediaPipeDetector(),
  recorder: stream => {
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video. Try a current Chrome, Edge or Safari browser.');
    const mimeType=recordingMime(type=>MediaRecorder.isTypeSupported(type));
    return new MediaRecorder(stream,mimeType?{mimeType}:undefined);
  },
  bitmap: async (video,unmirror) => {
    canvas??=document.createElement('canvas');
    const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
    const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas 2D is unavailable.');
    // Preview mirroring is CSS only. This option is for a source whose actual pixels are mirrored.
    ctx.setTransform(unmirror?-1:1,0,0,1,unmirror?canvas.width:0,0);
    ctx.drawImage(video,0,0,canvas.width,canvas.height);return canvas;
  },
  now:()=>performance.now(),
  dispose:()=>{if(canvas){canvas.width=0;canvas.height=0;canvas=undefined;}},
};
}
export function cameraError(error: unknown) {
  const name=error instanceof Error?error.name:'';
  if(name==='NotAllowedError')return 'Camera permission failure: camera permission was denied. Allow camera access in browser settings and retry.';
  if(name==='NotFoundError')return 'No camera was found. Connect a camera and retry.';
  if(name==='NotReadableError')return 'The camera is busy or unavailable. Close other camera applications and retry.';
  return error instanceof Error?error.message:'Camera or recording failed. Please retry.';
}
// One controller owns every camera/recorder/detector resource for one attempt.
// Direct frame extraction avoids relying on often-infinite MediaRecorder WebM duration metadata.
export class WebcamCapture {
  private stream?: MediaStream;
  private detector?: LandmarkDetector;
  private recorder?: MediaRecorder;
  private video?: HTMLVideoElement;
  private closed=false;
  private stopping=false;
  private timer?: ReturnType<typeof setTimeout>;
  private limit?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private inferenceTimeout?: ReturnType<typeof setTimeout>;
  private lastVideoTime=-1;
  private lastFresh=0;
  private completedAt:number[]=[];
  private stopTimeout?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private finish?: (result: CaptureResult)=>void;
  private reject?: (error: Error)=>void;
  private frames: MotionClip['frames']=[];
  private chunks: Blob[]=[];
  private started=0;
  private duration=0;
  private unmirror=false;
  private width=0;
  private height=0;
  constructor(private platform: CapturePlatform=browserPlatform(),private onFailure: (error:Error)=>void=()=>{}, private onDiagnostics:(d:TrackingDiagnostics)=>void=()=>{}) {}
  async open(video: HTMLVideoElement) {
    if(this.closed)throw new Error('This camera session has ended. Retry to open a new session.');
    this.video=video;
    let stage='Video capture failure';
    try {
      const stream=await this.platform.camera();
      if(this.closed){stopTracks(stream);throw new DOMException('Camera canceled','AbortError');}
      this.stream=stream;
      for(const track of stream.getVideoTracks()){track.addEventListener('ended',this.interrupted);track.addEventListener('mute',this.interrupted);}
      video.srcObject=stream;
      await video.play();
      if(this.closed)throw new DOMException('Camera canceled','AbortError');
      if(!video.videoWidth||!video.videoHeight)throw new Error('Camera frames are unavailable.');
      this.width=video.videoWidth;this.height=video.videoHeight;
      this.recorder=this.platform.recorder(stream);
      stage='Model initialization failure';
      this.detector=this.platform.detector();
      this.reportModel('loading');await this.detector.initialize();
      if(this.closed)throw new DOMException('Camera canceled','AbortError');
      this.reportModel('ready');
    } catch(error) {
      if(error instanceof Error && (error.name==='AbortError'||error.name==='NotAllowedError')){this.dispose();throw error;}
      if(stage==='Model initialization failure')this.reportModel('failed');
      this.dispose();const failure=new Error(`${stage}: ${cameraError(error)}`);if(error instanceof Error)failure.name=error.name;throw failure;
    }
  }
  private reportModel(model:TrackingDiagnostics['model']) {this.onDiagnostics({model,backend:this.detector?.id??'',fps:0,body:'waiting',left:'waiting',right:'waiting',coverage:0,reasons:[],width:this.width,height:this.height});}
  private interrupted=()=>this.fail(new Error('Video capture failure: camera interrupted or muted. This attempt was discarded; reconnect and retry or process a phone video.'));
  record(unmirror=false,onFrame: (count:number,seconds:number)=>void=()=>{}):Promise<CaptureResult> {
    if(this.closed||!this.recorder||!this.detector||!this.video||this.finish)return Promise.reject(new Error('Camera is not ready for recording.'));
    this.unmirror=unmirror;this.started=this.platform.now();this.lastFresh=this.started;const reconstruction=new Reconstructor();
    const result=new Promise<CaptureResult>((resolve,reject)=>{this.finish=resolve;this.reject=reject;});
    const recorder=this.recorder;
    recorder.ondataavailable=e=>{if(e.data.size)this.chunks.push(e.data);};
    recorder.onerror=()=>this.fail(new Error('Video capture failure: video recording failed. Please retry.'));
    recorder.onstop=()=>{void this.complete();};
    try {
      recorder.start(250);
      this.watchdog=setInterval(()=>{
        if(!this.closed&&!this.stopping&&!this.inferenceTimeout&&this.platform.now()-this.lastFresh>2500)this.fail(new Error('Video capture failure: no new camera frames for 2.5 seconds. Attempt discarded; retry or process a phone video.'));
      },250);
      const sample=()=>{
        if(this.closed||this.stopping)return;
        if(this.video!.videoWidth!==this.width||this.video!.videoHeight!==this.height){this.fail(new Error('Video capture failure: camera orientation changed. Keep the phone orientation fixed and retry.'));return;}
        if(this.video!.currentTime===this.lastVideoTime || this.video!.readyState<2){this.timer=setTimeout(sample,50);return;}
        this.lastVideoTime=this.video!.currentTime;this.lastFresh=this.platform.now();
        const timestamp=this.frames.length?Math.max(this.frames.at(-1)!.timestamp+.001,this.platform.now()-this.started):0;
        this.pending=(async()=>{
          const bitmap=await this.platform.bitmap(this.video!,unmirror);
          if(this.closed){releaseFrame(bitmap);return;}
          this.inferenceTimeout=setTimeout(()=>this.fail(new Error('Inference failure: processing timed out. Try processing a phone video.')),10000);
          const detection=await this.detector!.detect(bitmap,timestamp);
          clearTimeout(this.inferenceTimeout);this.inferenceTimeout=undefined;
          if(this.closed)return;
          const frame=reconstruction.reconstruct(detection);this.frames.push(frame);onFrame(this.frames.length,timestamp/1000);
          const now=this.platform.now();this.completedAt.push(now);if(this.completedAt.length>30)this.completedAt.shift();
          const fps=this.completedAt.length>1?(this.completedAt.length-1)*1000/(now-this.completedAt[0]):0;
          const tracking=inspectTracking(frame);
          if(fps>0&&fps<5)tracking.reasons.push('Processing is below 5 FPS. Phone-video processing is recommended for fast hand movement.');
          this.onDiagnostics({model:'ready',backend:this.detector!.id,fps,...tracking,frame,width:this.width,height:this.height});
        })();
        void this.pending.then(()=>{if(!this.closed&&!this.stopping)this.timer=setTimeout(sample,Math.max(10,1000/15-(this.platform.now()-this.started-timestamp)));},error=>{if(!this.closed)this.fail(new Error(`Inference failure: ${cameraError(error)}`));});
      };
      sample();this.limit=setTimeout(()=>this.stop(),20000);
    } catch(error) {this.fail(error instanceof Error?error:new Error('Recording could not start.'));}
    return result;
  }
  stop() {
    if(this.closed||this.stopping||!this.finish)return;
    this.stopping=true;this.duration=(this.platform.now()-this.started)/1000;
    clearTimeout(this.timer);clearTimeout(this.limit);clearInterval(this.watchdog);
    // Release the camera immediately, even if inference or recorder finalization is still pending.
    this.releaseCamera();
    if(this.recorder?.state!=='inactive') {
      this.stopTimeout=setTimeout(()=>this.fail(new Error('Recording finalization timed out. Please retry.')),5000);
      try {this.recorder?.stop();} catch(error) {this.fail(error instanceof Error?error:new Error('Recording could not stop.'));}
    } else this.fail(new Error('Recording ended unexpectedly. Please retry.'));
  }
  private async complete() {
    if(!this.stopping&&!this.closed){this.fail(new Error('Recording ended unexpectedly. Please retry.'));return;}
    clearTimeout(this.stopTimeout);
    try {
      await this.pending;if(this.closed)return;
      assertTracking(this.frames);
      const span=(this.frames.at(-1)!.timestamp-this.frames[0].timestamp)/1000;
      if(span>1&&(this.frames.length-1)/span<5)throw new Error('Inference succeeded, but processed FPS was below 5: insufficient motion sampling. Record a phone video and process it afterward.');
      const recording=new Blob(this.chunks,{type:this.recorder!.mimeType});
      if(!recording.size)throw new Error('The recorder returned an empty video. Please retry.');
      const clip:MotionClip={schema:'signlingo.motion',version:1,language:'ksl',pipeline:{version:PIPELINE_VERSION,detector:this.detector!.id,models:MODELS},source:{name:'local-webcam',size:recording.size,duration:Math.max(this.duration,this.frames.at(-1)!.timestamp/1000+.001),width:this.width,height:this.height,mirrored:this.unmirror,sampleHz:15},spaces:SPACES,nonmanual:{head:'Approximate orientation only',face:'not-estimated',linguisticValidation:'not-performed'},frames:this.frames,edits:[]};
      const finish=this.finish;this.finish=undefined;this.reject=undefined;this.dispose();finish?.({clip,recording});
    } catch(error) {this.fail(error instanceof Error?error:new Error('Motion extraction failed.'));}
  }
  private releaseCamera() {
    for(const track of this.stream?.getVideoTracks()??[]){track.removeEventListener('ended',this.interrupted);track.removeEventListener('mute',this.interrupted);}
    stopTracks(this.stream);this.stream=undefined;
    if(this.video)this.video.srcObject=null;
  }
  private dispose() {
    this.closed=true;clearTimeout(this.inferenceTimeout);clearTimeout(this.timer);clearTimeout(this.limit);clearInterval(this.watchdog);clearTimeout(this.stopTimeout);
    if(this.recorder) {this.recorder.onstop=null;this.recorder.onerror=null;this.recorder.ondataavailable=null;if(this.recorder.state!=='inactive')try{this.recorder.stop();}catch{/* Already unavailable. */}}
    this.releaseCamera();this.detector?.close();this.detector=undefined;this.platform.dispose?.();this.chunks=[];this.frames=[];
  }
  private fail(error: Error) {if(this.closed)return;const reject=this.reject;this.finish=undefined;this.reject=undefined;this.dispose();reject?.(error);this.onFailure(error);}
  cancel() {this.fail(new DOMException('Practice canceled','AbortError'));}
}
