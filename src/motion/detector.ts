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
export class MediaPipeDetector implements LandmarkDetector {
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
