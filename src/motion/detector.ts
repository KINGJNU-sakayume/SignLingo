import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MODELS } from './types';
import type { Detection, HandRegionSettings } from './types';
import type { FusionTrace } from './handRegions';
import { cleanLandmarks, detectWithRegions, handsFrom, regionLandmarkerOptions } from './visionResult';
export type VisionFrame = ImageBitmap | HTMLCanvasElement;
export function releaseFrame(frame: VisionFrame) { if ('close' in frame) frame.close(); }
// Future GPU/server adapters return the SAME explicit raw coordinate contract.
// A mesh-only model must convert its joint convention before implementing this interface.
export interface LandmarkDetector {
  readonly id: string;
  /** Present when hands are also re-detected in pose-predicted crops (pipeline 0.3.0). */
  readonly handRegions?: HandRegionSettings;
  /** Diagnostics of the latest detect() with hand regions; not part of the Detection or any MotionClip. */
  readonly lastFusion?: FusionTrace;
  initialize(): Promise<void>;
  /** `detail` is the same decoded frame at higher resolution, used only for hand-region crops. Both frames are released. */
  detect(frame: VisionFrame, timestampMs: number, detail?: VisionFrame): Promise<Detection>;
  close(): void;
}
export type DetectorOptions = { handRegions?: HandRegionSettings };
type Pending = { resolve: (value: Detection) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
class WorkerMediaPipeDetector implements LandmarkDetector {
  readonly id='mediapipe-tasks-vision@1.1.0';
  readonly handRegions?: HandRegionSettings;
  lastFusion?: FusionTrace;
  constructor(options: DetectorOptions = {}) { this.handRegions=options.handRegions; }
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
      this.worker!.postMessage({type:'init',handRegions:this.handRegions});
    });
    this.worker.onmessage=e=>{
      if (!this.pending) return;
      const pending=this.pending;this.pending=undefined;clearTimeout(pending.timer);
      if (e.data.type==='result') { this.lastFusion=e.data.fusion;pending.resolve(e.data.result); }
      else pending.reject(new Error(e.data.message || 'Unexpected detector response.'));
    };
    this.worker.onerror=e=>{ if (this.pending) { clearTimeout(this.pending.timer);this.pending.reject(new Error(e.message));this.pending=undefined; } };
  }
  detect(frame: ImageBitmap,timestampMs: number,detail?: ImageBitmap) {
    this.lastFusion=undefined;
    if (!this.worker || this.pending) { frame.close();detail?.close();return Promise.reject(new Error('Detector is not ready for another frame.')); }
    return new Promise<Detection>((resolve,reject)=>{
      const timer=setTimeout(()=>{ this.pending=undefined;reject(new Error('Frame inference timed out. Try a smaller video or another browser.'));},45000);
      this.pending={resolve,reject,timer};
      try { this.worker!.postMessage({type:'detect',frame,detail,timestampMs},detail?[frame,detail]:[frame]); }
      catch(error) { clearTimeout(timer);this.pending=undefined;frame.close();detail?.close();reject(error); }
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

export class MainThreadMediaPipeDetector implements LandmarkDetector {
  readonly id='mediapipe-tasks-vision@1.1.0-main-thread';
  readonly handRegions?: HandRegionSettings;
  private pose?:PoseLandmarker;
  private hands?:HandLandmarker;
  private regionHands?:HandLandmarker;
  private surface?:HTMLCanvasElement;
  lastFusion?:FusionTrace;
  private closed=false;
  constructor(options:DetectorOptions={}) {this.handRegions=options.handRegions;}

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
      if(this.handRegions){
        runtime.ModuleFactory=loader.default;
        const regionHands=await HandLandmarker.createFromOptions(files,regionLandmarkerOptions(this.handRegions));
        if(this.closed){regionHands.close();throw new DOMException('Processing canceled','AbortError');}
        this.regionHands=regionHands;
      }
    } catch(error) {
      this.close();
      throw error;
    }
  }

  async detect(frame:VisionFrame,timestampMs:number,detail?:VisionFrame):Promise<Detection> {
    // Yield a macrotask before synchronous inference so Safari can paint
    // progress and process a Cancel click between sampled frames.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    this.lastFusion=undefined;
    try {
      if(this.closed || !this.pose || !this.hands)throw new DOMException('Processing canceled','AbortError');
      const p=this.pose.detectForVideo(frame,timestampMs);
      const h=this.hands.detectForVideo(frame,timestampMs);
      const body=cleanLandmarks(p.landmarks[0]??[]);
      let hands=handsFrom(h);
      if(this.regionHands&&this.handRegions){
        this.surface??=document.createElement('canvas');
        const refined=await detectWithRegions({body,frameHands:hands,source:detail??frame,surface:this.surface,landmarker:this.regionHands,settings:this.handRegions});
        hands=refined.hands;this.lastFusion=refined.trace;
      }
      return {timestamp:timestampMs,body,bodyWorld:cleanLandmarks(p.worldLandmarks[0]??[]),hands};
    } finally {
      releaseFrame(frame);
      if(detail)releaseFrame(detail);
    }
  }

  close():void {
    this.closed=true;
    this.pose?.close();this.pose=undefined;
    this.hands?.close();this.hands=undefined;
    this.regionHands?.close();this.regionHands=undefined;
  }
}

/** Selects the existing worker path unless WebKit requires the DOM fallback. */
export class MediaPipeDetector implements LandmarkDetector {
  private backend?:LandmarkDetector;
  private closed=false;
  private abort=new AbortController();
  private ready=false;
  private busy=false;
  constructor(
    private factories:{worker:(options:DetectorOptions)=>LandmarkDetector;main:(options:DetectorOptions)=>LandmarkDetector}={worker:options=>new WorkerMediaPipeDetector(options),main:options=>new MainThreadMediaPipeDetector(options)},
    private options:DetectorOptions={},
  ) {}
  get id():string {return this.backend?.id??'mediapipe-tasks-vision@1.1.0';}
  get handRegions():HandRegionSettings|undefined {return this.options.handRegions;}
  get lastFusion():FusionTrace|undefined {return this.backend?.lastFusion;}
  private async initializeBackend(main:boolean) {
    if(this.closed)throw new DOMException('Processing canceled','AbortError');
    const backend=main?this.factories.main(this.options):this.factories.worker(this.options);this.backend=backend;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let abort:()=>void=()=>{};
    try {
      await Promise.race([backend.initialize(),new Promise<never>((_,reject)=>{
        abort=()=>reject(new DOMException('Processing canceled','AbortError'));
        this.abort.signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>reject(new Error('Model initialization timed out. Check model downloads and retry.')),120000);
      })]);
      if(this.closed)throw new DOMException('Processing canceled','AbortError');
    } catch(error){backend.close();throw error;}
    finally{clearTimeout(timer);this.abort.signal.removeEventListener('abort',abort);}
  }
  async initialize():Promise<void> {
    const main=prefersMainThreadVision(navigator.userAgent,navigator.platform,navigator.maxTouchPoints) || typeof Worker==='undefined' || typeof createImageBitmap==='undefined';
    try {await this.initializeBackend(main);}
    catch(error){if(main||this.closed||!needsDocument(error))throw error;await this.initializeBackend(true);}
    this.ready=true;
  }
  async detect(frame:VisionFrame,timestampMs:number,detail?:VisionFrame):Promise<Detection> {
    if(this.closed||!this.ready||!this.backend||this.busy){releaseFrame(frame);if(detail)releaseFrame(detail);throw new Error('Detector is not ready for another frame.');}
    this.busy=true;
    try {
      const worker=this.backend.id.indexOf('main-thread')<0;
      // Keep the canvas snapshots for a DOM-error retry; only transfer their bitmaps.
      const input=worker && !('close' in frame)?await createImageBitmap(frame):frame;
      const detailInput=detail&&worker&&!('close' in detail)?await createImageBitmap(detail):detail;
      if(this.closed){releaseFrame(input);if(detailInput)releaseFrame(detailInput);throw new DOMException('Processing canceled','AbortError');}
      const run=(backend:LandmarkDetector,a:VisionFrame,b?:VisionFrame)=>b?backend.detect(a,timestampMs,b):backend.detect(a,timestampMs);
      try{return await run(this.backend,input,detailInput);}
      catch(error){
        if(!worker||this.closed||!needsDocument(error)||'close' in frame||(detail&&'close' in detail))throw error;
        this.backend.close();await this.initializeBackend(true);
        return await run(this.backend!,frame,detail);
      }
    } finally{this.busy=false;}
  }
  close():void {this.closed=true;this.ready=false;this.abort.abort();this.backend?.close();this.backend=undefined;}
}
