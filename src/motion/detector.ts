import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MODELS } from './types';
import type { Landmark } from './types';
import type { Detection } from './types';
// Future GPU/server adapters return the SAME explicit raw coordinate contract.
// A mesh-only model must convert its joint convention before implementing this interface.
export interface LandmarkDetector {
  readonly id: string;
  initialize(): Promise<void>;
  detect(frame: ImageBitmap, timestampMs: number): Promise<Detection>;
  close(): void;
}
type Pending = { resolve: (value: Detection) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
class WorkerMediaPipeDetector implements LandmarkDetector {
  readonly id='mediapipe-tasks-vision@1.1.0';
  private worker?: Worker;
  private pending?: Pending;
  private initialization?: {reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>};
  async initialize() {
    this.worker=new Worker(new URL('./detector.worker.ts',import.meta.url),{type:'module'});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.initialization=undefined;this.close();reject(new Error('Model initialization timed out. Check access to storage.googleapis.com and cdn.jsdelivr.net.'));},120000);
      this.initialization={reject,timer};
      this.worker!.onerror=e=>{clearTimeout(timer);this.initialization=undefined;reject(new Error(e.message || 'Vision worker failed to start.'));};
      this.worker!.onmessage=e=>{
        if (e.data.type==='ready') { clearTimeout(timer);this.initialization=undefined;resolve(); }
        if (e.data.type==='error') { clearTimeout(timer);this.initialization=undefined;reject(new Error(e.data.message)); }
      };
      this.worker!.postMessage({type:'init'});
    });
    this.worker.onmessage=e=>{
      if (!this.pending) return;
      const pending=this.pending;this.pending=undefined;clearTimeout(pending.timer);
      if (e.data.type==='result') pending.resolve(e.data.result);
      else pending.reject(new Error(e.data.message || 'Unexpected detector response.'));
    };
    this.worker.onerror=e=>{ if (this.pending) { clearTimeout(this.pending.timer);this.pending.reject(new Error(e.message));this.pending=undefined; } };
  }
  detect(frame: ImageBitmap,timestampMs: number) {
    if (!this.worker || this.pending) { frame.close();return Promise.reject(new Error('Detector is not ready for another frame.')); }
    return new Promise<Detection>((resolve,reject)=>{
      const timer=setTimeout(()=>{ this.pending=undefined;reject(new Error('Frame inference timed out. Try a smaller video or another browser.'));},45000);
      this.pending={resolve,reject,timer};
      this.worker!.postMessage({type:'detect',frame,timestampMs},[frame]);
    });
  }
  close() { if(this.initialization){clearTimeout(this.initialization.timer);this.initialization.reject(new DOMException('Processing canceled','AbortError'));this.initialization=undefined;} if (this.pending) { clearTimeout(this.pending.timer);this.pending.reject(new DOMException('Processing canceled','AbortError'));this.pending=undefined; } this.worker?.terminate();this.worker=undefined; }
}

/**
 * MediaPipe's WebKit worker path can try to access document, which is absent
 * inside workers. Keep the worker backend for supported browsers, but execute
 * Tasks Vision on the document-owning thread on iOS/iPadOS.
 *
 * This affects where inference runs, not the stored landmark contract.
 */
export function prefersMainThreadVision(userAgent:string,platform:string,maxTouchPoints:number):boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform==='MacIntel' && maxTouchPoints>1);
}
const needsDocument=(error:unknown)=>/\b(document|OffscreenCanvas)\b/i.test(error instanceof Error?error.message:String(error));
const cleanLandmarks=(points:Landmark[],hasConfidence=true)=>points.map(p=>({
  x:p.x,y:p.y,z:p.z,
  ...(hasConfidence&&Number.isFinite(p.visibility)?{visibility:p.visibility}:{}),
  ...(hasConfidence&&Number.isFinite(p.presence)?{presence:p.presence}:{})
}));

class MainThreadMediaPipeDetector implements LandmarkDetector {
  readonly id='mediapipe-tasks-vision@1.1.0-main-thread';
  private pose?:PoseLandmarker;
  private hands?:HandLandmarker;
  private closed=false;

  async initialize():Promise<void> {
    try {
      // Lazy-load the large vision package only when this fallback is needed.
      const {FilesetResolver,PoseLandmarker,HandLandmarker}=await import('@mediapipe/tasks-vision');
      if(this.closed)throw new DOMException('Processing canceled','AbortError');
      const files=await FilesetResolver.forVisionTasks(MODELS.wasm,true);
      if(this.closed)throw new DOMException('Processing canceled','AbortError');
      // Tasks 1.1 clears ModuleFactory after initializing each task.
      // Restore the same module factory before creating the second task.
      const loader=await import(/* @vite-ignore */ files.wasmLoaderPath);
      if(this.closed)throw new DOMException('Processing canceled','AbortError');
      const runtime=globalThis as typeof globalThis & {ModuleFactory?:unknown};
      runtime.ModuleFactory=loader.default;
      const pose=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:MODELS.pose,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5});
      if(this.closed){pose.close();throw new DOMException('Processing canceled','AbortError');}
      this.pose=pose;
      runtime.ModuleFactory=loader.default;
      const hands=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:MODELS.hand,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:0.5,minHandPresenceConfidence:0.5,minTrackingConfidence:0.5});
      if(this.closed){hands.close();throw new DOMException('Processing canceled','AbortError');}
      this.hands=hands;
    } catch(error) {
      this.close();
      throw error;
    }
  }

  async detect(frame:ImageBitmap,timestampMs:number):Promise<Detection> {
    // Yield a macrotask before synchronous inference so Safari can paint
    // progress and process a Cancel click between sampled frames.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    try {
      if(this.closed || !this.pose || !this.hands)throw new DOMException('Processing canceled','AbortError');
      const p=this.pose.detectForVideo(frame,timestampMs);
      const h=this.hands.detectForVideo(frame,timestampMs);
      return {
        timestamp:timestampMs,
        body:cleanLandmarks(p.landmarks[0]??[]),
        bodyWorld:cleanLandmarks(p.worldLandmarks[0]??[]),
        hands:h.landmarks.map((landmarks,i)=>({
          image:cleanLandmarks(landmarks,false),
          world:cleanLandmarks(h.worldLandmarks[i]??[],false),
          label:h.handedness[i]?.[0]?.categoryName??'Unknown',
          score:h.handedness[i]?.[0]?.score??0
        }))
      };
    } finally {
      frame.close();
    }
  }

  close():void {
    this.closed=true;
    this.pose?.close();this.pose=undefined;
    this.hands?.close();this.hands=undefined;
  }
}

/** Selects the existing worker path unless WebKit requires the DOM fallback. */
export class MediaPipeDetector implements LandmarkDetector {
  private backend?:LandmarkDetector;
  private closed=false;
  get id():string {return this.backend?.id??'mediapipe-tasks-vision@1.1.0';}
  async initialize():Promise<void> {
    if(prefersMainThreadVision(navigator.userAgent,navigator.platform,navigator.maxTouchPoints)){
      const main=new MainThreadMediaPipeDetector();this.backend=main;
      await main.initialize();
      return;
    }
    const worker=new WorkerMediaPipeDetector();this.backend=worker;
    try {
      await worker.initialize();
    } catch(error) {
      worker.close();
      if(this.closed || !needsDocument(error))throw error;
      const main=new MainThreadMediaPipeDetector();this.backend=main;
      await main.initialize();
    }
  }
  detect(frame:ImageBitmap,timestampMs:number):Promise<Detection> {
    if(!this.backend){frame.close();return Promise.reject(new Error('Detector is not initialized.'));}
    return this.backend.detect(frame,timestampMs);
  }
  close():void {this.closed=true;this.backend?.close();this.backend=undefined;}
}
