// Synthetic video events verify timing/cleanup; physical decoder speed is not measured.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {seekPresentation} from '../src/motion/decodedFrame';
import {cadence} from '../src/motion/timing';
function video(delay:number,pts?:number) {
  const target=new EventTarget();let time=0,callback:VideoFrameRequestCallback|undefined;
  const cancel=vi.fn(()=>{callback=undefined;});
  Object.defineProperties(target,{
    currentTime:{get:()=>time,set:(value:number)=>{time=value;setTimeout(()=>{target.dispatchEvent(new Event('seeked'));if(pts!==undefined)callback?.(0,{mediaTime:pts} as VideoFrameCallbackMetadata);},delay);}},
    readyState:{value:4},requestVideoFrameCallback:{value:(fn:VideoFrameRequestCallback)=>{callback=fn;return 1;}},cancelVideoFrameCallback:{value:cancel},
  });
  return {element:target as HTMLVideoElement,cancel};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('retains decoded PTS even when a seek takes longer than the callback timeout',async()=>{
  const v=video(600,.4667),result=seekPresentation(v.element,.5,new AbortController().signal);
  await vi.advanceTimersByTimeAsync(601);expect(await result).toBe(.4667);expect(v.cancel).toHaveBeenCalled();
});
it('withholds a seek with no confirmed presentation instead of inventing evidence',async()=>{
  const v=video(600),result=seekPresentation(v.element,.5,new AbortController().signal);
  await vi.advanceTimersByTimeAsync(801);expect(await result).toBeUndefined();expect(v.cancel).toHaveBeenCalled();
});
it('cancels a pending decode and releases its presentation callback',async()=>{
  const v=video(600,.5),controller=new AbortController(),result=seekPresentation(v.element,.5,controller.signal);
  const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;expect(v.cancel).toHaveBeenCalled();
});
it('does not count repeated timestamps as fresh frame delivery',()=>{
  expect(cadence([0,.1,.1,.2])).toMatchObject({samples:4,fps:10,duplicateTimes:1});
});
