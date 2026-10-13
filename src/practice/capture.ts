import { cadence,type CaptureMeasurements } from '../motion/timing';
export type CaptureResult={recording:Blob;measurements:CaptureMeasurements};
export type CapturePlatform={camera:()=>Promise<MediaStream>;recorder:(stream:MediaStream)=>MediaRecorder;now:()=>number};
export function recordingMime(supported:(type:string)=>boolean){return ['video/webm;codecs=vp8','video/webm','video/mp4'].find(supported);}
export function stopTracks(stream?:MediaStream){stream?.getTracks().forEach(track=>track.stop());}
const browser:CapturePlatform={
  camera:()=>{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera requires HTTPS and getUserMedia support.');return navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720},frameRate:{ideal:30}},audio:false});},
  recorder:stream=>{if(typeof MediaRecorder==='undefined')throw new Error('This browser cannot record video. Use the phone-video input.');const mimeType=recordingMime(t=>MediaRecorder.isTypeSupported(t));return new MediaRecorder(stream,mimeType?{mimeType}:undefined);},
  now:()=>performance.now(),
};
export function cameraError(error:unknown){
  const name=error instanceof Error?error.name:'';
  if(name==='NotAllowedError')return 'Camera permission failure: camera permission was denied. Allow camera access in browser settings and retry.';
  if(name==='NotFoundError')return 'No camera was found. Connect a camera and retry.';
  if(name==='NotReadableError')return 'The camera is busy or unavailable. Close other camera applications and retry.';
  return error instanceof Error?error.message:'Camera or recording failed. Please retry.';
}
// Recording owns camera/encoder only. No detector is initialized or run here,
// including on iOS where synchronous Tasks inference blocks the document thread.
export class WebcamCapture {
  private stream?:MediaStream;private video?:HTMLVideoElement;private recorder?:MediaRecorder;
  private closed=false;private stopping=false;private chunks:Blob[]=[];
  private started=0;private duration=0;private width=0;private height=0;private reportedFps:number|null=null;
  private times:number[]=[];private presented:number[]=[];private lastFresh=0;
  private frameCallback?:number;private poll?:ReturnType<typeof setInterval>;private limit?:ReturnType<typeof setTimeout>;private deadline?:ReturnType<typeof setTimeout>;
  private resolve?: (result:CaptureResult)=>void;private reject?: (error:Error)=>void;
  constructor(private platform:CapturePlatform=browser,private onFailure:(error:Error)=>void=()=>{},private onMeasurements:(value:CaptureMeasurements)=>void=()=>{}){}
  async open(video:HTMLVideoElement){
    if(this.closed)throw new Error('This camera session has ended. Retry.');this.video=video;
    try {
      const stream=await this.platform.camera();if(this.closed){stopTracks(stream);throw new DOMException('Camera canceled','AbortError');}
      this.stream=stream;for(const track of stream.getVideoTracks()){track.addEventListener('ended',this.interrupted);track.addEventListener('mute',this.interrupted);}
      const settings=stream.getVideoTracks()[0]?.getSettings?.();this.reportedFps=settings?.frameRate??null;
      video.srcObject=stream;await video.play();if(this.closed)throw new DOMException('Camera canceled','AbortError');
      if(!video.videoWidth||!video.videoHeight)throw new Error('Camera frames are unavailable.');
      this.width=video.videoWidth;this.height=video.videoHeight;this.recorder=this.platform.recorder(stream);this.onMeasurements(this.measurements());
    }catch(error){this.dispose();throw error;}
  }
  private interrupted=()=>this.fail(new Error('Video capture failure: camera interrupted or muted. Reconnect and retry.'));
  private measurements():CaptureMeasurements{return {requestedCameraFps:30,reportedTrackFps:this.reportedFps,delivery:cadence(this.times,this.presented),deliveryMethod:this.video?.requestVideoFrameCallback?'video-frame-callback':'video-clock-poll',encodedRecordingFps:null,duration:this.duration|| (this.resolve?(this.platform.now()-this.started)/1000:0),width:this.width,height:this.height};}
  record():Promise<CaptureResult>{
    if(this.closed||!this.recorder||!this.video||this.resolve)return Promise.reject(new Error('Camera is not ready for recording.'));
    this.started=this.platform.now();this.lastFresh=this.started;
    const result=new Promise<CaptureResult>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    this.recorder.ondataavailable=e=>{if(e.data.size)this.chunks.push(e.data);};this.recorder.onerror=()=>this.fail(new Error('Video recording failed. Please retry.'));this.recorder.onstop=()=>this.complete();
    try{
      this.recorder.start(250);
      const delivered=(_:number,metadata:VideoFrameCallbackMetadata)=>{
        if(this.closed||this.stopping)return;
        this.times.push(metadata.mediaTime);this.presented.push(metadata.presentedFrames);this.lastFresh=this.platform.now();
        this.frameCallback=this.video!.requestVideoFrameCallback(delivered);
      };
      if(this.video.requestVideoFrameCallback)this.frameCallback=this.video.requestVideoFrameCallback(delivered);
      this.poll=setInterval(()=>{
        if(this.video!.videoWidth!==this.width||this.video!.videoHeight!==this.height){this.fail(new Error('Camera orientation changed. Keep the phone orientation fixed and retry.'));return;}
        if(!this.video!.requestVideoFrameCallback&&this.video!.readyState>=2&&this.video!.currentTime!==this.times.at(-1)){this.times.push(this.video!.currentTime);this.lastFresh=this.platform.now();}
        if(this.platform.now()-this.lastFresh>2500){this.fail(new Error('Video capture failure: no new camera frames for 2.5 seconds. Retry.'));return;}
        this.onMeasurements(this.measurements());
      },100);
      this.limit=setTimeout(()=>this.stop(),20000);
    }catch(error){this.fail(error instanceof Error?error:new Error('Recording could not start.'));}
    return result;
  }
  stop(){
    if(this.closed||this.stopping||!this.resolve)return;this.stopping=true;this.duration=(this.platform.now()-this.started)/1000;this.stopMonitor();
    // Stop the encoder before ending tracks; some mobile encoders auto-stop when
    // their source ends. Cleanup is immediate and independent of analysis speed.
    if(this.recorder?.state==='inactive'){this.fail(new Error('Recording ended unexpectedly.'));return;}
    this.deadline=setTimeout(()=>this.fail(new Error('Recording finalization timed out. Please retry.')),5000);
    try{this.recorder!.stop();this.releaseCamera();}catch(error){this.fail(error instanceof Error?error:new Error('Recording could not stop.'));}
  }
  private complete(){
    if(this.closed)return;if(!this.stopping){this.fail(new Error('Recording ended unexpectedly.'));return;}
    const recording=new Blob(this.chunks,{type:this.recorder!.mimeType});
    if(!recording.size){this.fail(new Error('The recorder returned an empty video. Please retry.'));return;}
    if(this.duration<.2){this.fail(new Error('Recording is too short. Record the complete sign.'));return;}
    const measurements=this.measurements(),resolve=this.resolve;this.resolve=undefined;this.reject=undefined;this.dispose();this.onMeasurements(measurements);resolve?.({recording,measurements});
  }
  private stopMonitor(){clearInterval(this.poll);clearTimeout(this.limit);if(this.frameCallback!==undefined)this.video?.cancelVideoFrameCallback(this.frameCallback);this.frameCallback=undefined;}
  private releaseCamera(){for(const track of this.stream?.getVideoTracks()??[]){track.removeEventListener('ended',this.interrupted);track.removeEventListener('mute',this.interrupted);}stopTracks(this.stream);this.stream=undefined;if(this.video)this.video.srcObject=null;}
  private dispose(){this.closed=true;this.stopMonitor();clearTimeout(this.deadline);if(this.recorder){this.recorder.onstop=null;this.recorder.onerror=null;this.recorder.ondataavailable=null;if(this.recorder.state!=='inactive')try{this.recorder.stop();}catch{/* unavailable */}}this.releaseCamera();this.chunks=[];}
  private fail(error:Error){if(this.closed)return;const reject=this.reject;this.reject=undefined;this.resolve=undefined;this.dispose();reject?.(error);this.onFailure(error);}
  cancel(){this.fail(new DOMException('Practice canceled','AbortError'));}
}
