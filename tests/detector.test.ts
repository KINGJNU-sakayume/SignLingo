import { describe,expect,it } from 'vitest';
import { prefersMainThreadVision } from '../src/motion/detector';

describe('MediaPipe inference backend selection',()=>{
  it('uses a document-backed detector on iPhones',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15','iPhone',5)).toBe(true);
  });
  it('uses a document-backed detector on iPads presenting a desktop user agent',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15','MacIntel',5)).toBe(true);
  });
  it('keeps desktop Safari and Chrome on the worker backend',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15','MacIntel',0)).toBe(false);
    expect(prefersMainThreadVision('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0','Win32',0)).toBe(false);
  });
  it('does not infer iOS from a touch-enabled non-Apple device',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Linux; Android 14) Chrome/125.0','Linux armv8l',5)).toBe(false);
  });
});

import { afterEach,beforeEach,vi } from 'vitest';
import { MediaPipeDetector } from '../src/motion/detector';
import { detection } from './fixtures';
import { HAND_REGION_DEFAULTS } from '../src/motion/handRegions';
beforeEach(()=>{
  vi.stubGlobal('navigator',{userAgent:'Chrome',platform:'Linux',maxTouchPoints:0});
  vi.stubGlobal('Worker',class {});
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({close:vi.fn()})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function adapters(){
  const make=(id:string)=>({id,initialize:vi.fn(async()=>{}),detect:vi.fn(async()=>detection()),close:vi.fn()});
  const worker=make('worker'),main=make('main-thread');
  return {worker,main,detector:new MediaPipeDetector({worker:()=>worker,main:()=>main})};
}
it.each(['iPhone Safari','iPhone CriOS/130'])('routes %s to document-backed inference',async ua=>{
  vi.stubGlobal('navigator',{userAgent:ua,platform:'iPhone',maxTouchPoints:5});
  const s=adapters();await s.detector.initialize();expect(s.main.initialize).toHaveBeenCalledOnce();expect(s.worker.initialize).not.toHaveBeenCalled();
  const canvas={} as HTMLCanvasElement;await s.detector.detect(canvas,1);expect(s.main.detect).toHaveBeenCalledWith(canvas,1);s.detector.close();expect(s.main.close).toHaveBeenCalled();
});
it('keeps worker inference on Android and desktop and transfers a bitmap',async()=>{
  const s=adapters();await s.detector.initialize();await s.detector.detect({} as HTMLCanvasElement,3);
  expect(s.worker.detect).toHaveBeenCalledWith(expect.objectContaining({close:expect.any(Function)}),3);expect(s.main.initialize).not.toHaveBeenCalled();s.detector.close();
});
it('uses Canvas/main-thread when ImageBitmap is unavailable',async()=>{
  vi.stubGlobal('createImageBitmap',undefined);const s=adapters();await s.detector.initialize();expect(s.main.initialize).toHaveBeenCalled();
});
it('falls back only for worker DOM errors at initialization',async()=>{
  const s=adapters();s.worker.initialize.mockRejectedValue(new Error("Can't find variable: document"));await s.detector.initialize();expect(s.worker.close).toHaveBeenCalled();expect(s.main.initialize).toHaveBeenCalled();
  const failed=adapters();failed.worker.initialize.mockRejectedValue(new Error('model download failed'));await expect(failed.detector.initialize()).rejects.toThrow('download');expect(failed.main.initialize).not.toHaveBeenCalled();
});
it('retries a worker inference DOM failure using the retained canvas and timestamp',async()=>{
  const s=adapters();s.worker.detect.mockRejectedValue(new Error('OffscreenCanvas is unavailable'));await s.detector.initialize();
  const canvas={} as HTMLCanvasElement;await s.detector.detect(canvas,42);expect(s.main.detect).toHaveBeenCalledWith(canvas,42);expect(s.worker.close).toHaveBeenCalled();
});
it('cancels initialization promptly and never starts a fallback after cancellation',async()=>{
  const s=adapters();let reject!:(e:Error)=>void;s.worker.initialize.mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
  const opening=s.detector.initialize();const rejected=expect(opening).rejects.toMatchObject({name:'AbortError'});s.detector.close();await rejected;reject(new Error('document missing'));await Promise.resolve();expect(s.main.initialize).not.toHaveBeenCalled();
  await expect(s.detector.initialize()).rejects.toMatchObject({name:'AbortError'});
});
it('bounds initialization time and closes the backend',async()=>{
  vi.useFakeTimers();const s=adapters();s.worker.initialize.mockImplementation(()=>new Promise(()=>{}));const rejected=expect(s.detector.initialize()).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(120000);await rejected;expect(s.worker.close).toHaveBeenCalled();
});
it('passes hand-region settings to the selected backend and transfers the detail frame as a second bitmap',async()=>{
  const seen:unknown[]=[];const s=adapters();
  const detector=new MediaPipeDetector({worker:options=>{seen.push(options);return s.worker;},main:options=>{seen.push(options);return s.main;}},{handRegions:HAND_REGION_DEFAULTS});
  expect(detector.handRegions).toBe(HAND_REGION_DEFAULTS);
  await detector.initialize();expect(seen).toEqual([{handRegions:HAND_REGION_DEFAULTS}]);
  await detector.detect({} as HTMLCanvasElement,5,{} as HTMLCanvasElement);
  expect(createImageBitmap).toHaveBeenCalledTimes(2);
  expect(s.worker.detect).toHaveBeenCalledWith(expect.objectContaining({close:expect.any(Function)}),5,expect.objectContaining({close:expect.any(Function)}));
  detector.close();
});
it('releases both frames when it is not ready',async()=>{
  const s=adapters(),frame={close:vi.fn()} as unknown as ImageBitmap,detail={close:vi.fn()} as unknown as ImageBitmap;
  await expect(s.detector.detect(frame,1,detail)).rejects.toThrow('not ready');expect(frame.close).toHaveBeenCalledOnce();expect(detail.close).toHaveBeenCalledOnce();
});
