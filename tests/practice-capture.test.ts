import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { WebcamCapture,cameraError,recordingMime,type CapturePlatform } from '../src/practice/capture';
import { detection } from './fixtures';
import { importMotion } from '../src/motion/serialization';
function setup() {
  const track=new EventTarget() as EventTarget&{stop:ReturnType<typeof vi.fn>};track.stop=vi.fn();
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream;
  const video={srcObject:null,videoWidth:320,videoHeight:240,play:vi.fn().mockResolvedValue(undefined)} as unknown as HTMLVideoElement;
  const detector={id:'synthetic-detector',initialize:vi.fn().mockResolvedValue(undefined),detect:vi.fn(async(_bitmap:ImageBitmap,t:number)=>detection(t)),close:vi.fn()};
  const recorder={state:'inactive',mimeType:'video/webm',onstop:null as null|(()=>void),onerror:null as null|(()=>void),ondataavailable:null as null|((e:{data:Blob})=>void),start:vi.fn(function(){recorder.state='recording';}),stop:vi.fn(function(){recorder.state='inactive';recorder.ondataavailable?.({data:new Blob(['synthetic-recording-not-real-video'])});recorder.onstop?.();})};
  const platform:CapturePlatform={camera:vi.fn().mockResolvedValue(stream),detector:()=>detector,recorder:()=>recorder as unknown as MediaRecorder,bitmap:vi.fn().mockResolvedValue({close:vi.fn()}),now:()=>Date.now()};
  const failure=vi.fn(),controller=new WebcamCapture(platform,failure);
  return {track,stream,video,detector,recorder,platform,controller,failure};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
describe('camera and recording lifecycle',()=>{
  it('selects supported WebM/MP4 without assuming Safari has WebM',()=>{expect(recordingMime(t=>t==='video/mp4')).toBe('video/mp4');expect(recordingMime(()=>false)).toBeUndefined();});
  it('records measured frames with the existing detector/reconstructor and releases every resource',async()=>{
    const s=setup();await s.controller.open(s.video);const result=s.controller.record(true);
    await vi.advanceTimersByTimeAsync(600);s.controller.stop();expect(s.track.stop).toHaveBeenCalled();expect(s.video.srcObject).toBeNull();
    const recorded=await result;expect(recorded.clip.frames.length).toBeGreaterThan(3);expect(recorded.clip.frames[0].timestamp).toBe(0);expect(recorded.clip.source).toMatchObject({mirrored:true,width:320,height:240});
    expect(s.platform.bitmap).toHaveBeenCalledWith(s.video,true);expect(s.detector.close).toHaveBeenCalled();expect(recorded.recording.size).toBeGreaterThan(0);
    expect(importMotion(JSON.stringify(recorded.clip)).frames).toHaveLength(recorded.clip.frames.length);s.controller.cancel();expect(s.failure).not.toHaveBeenCalled();
  });
  it.each(['NotAllowedError','NotFoundError','NotReadableError'])('reports %s without starting capture',async name=>{
    const s=setup();s.platform.camera=vi.fn().mockRejectedValue(new DOMException('failed',name));await expect(s.controller.open(s.video)).rejects.toMatchObject({name});expect(cameraError(new DOMException('',name))).not.toBe('');expect(s.detector.initialize).not.toHaveBeenCalled();
  });
  it('stops a stream that arrives after permission was canceled',async()=>{
    const s=setup();let resolve!:(v:MediaStream)=>void;s.platform.camera=()=>new Promise(r=>{resolve=r;});const opened=s.controller.open(s.video);s.controller.cancel();resolve(s.stream);await expect(opened).rejects.toMatchObject({name:'AbortError'});expect(s.track.stop).toHaveBeenCalled();expect(s.video.srcObject).toBeNull();
  });
  it.each(['play','initialize','recorder'])('releases camera on %s setup failure',async stage=>{
    const s=setup();if(stage==='play')s.video.play=vi.fn().mockRejectedValue(new Error('playback failed'));if(stage==='initialize')s.detector.initialize.mockRejectedValue(new Error('model failed'));if(stage==='recorder')s.platform.recorder=()=>{throw new Error('unsupported');};await expect(s.controller.open(s.video)).rejects.toThrow();expect(s.track.stop).toHaveBeenCalled();expect(s.video.srcObject).toBeNull();
  });
  it('rejects a recorder error and a retry uses a fresh camera controller',async()=>{
    const s=setup();await s.controller.open(s.video);const result=s.controller.record();const rejected=expect(result).rejects.toThrow('recording failed');s.recorder.onerror?.();await rejected;expect(s.track.stop).toHaveBeenCalled();expect(s.detector.close).toHaveBeenCalled();
    const retry=setup();await retry.controller.open(retry.video);expect(retry.video.srcObject).toBe(retry.stream);retry.controller.cancel();expect(retry.track.stop).toHaveBeenCalled();
  });
  it('releases camera on frame extraction failure',async()=>{
    const s=setup();s.detector.detect.mockRejectedValue(new Error('inference failed'));await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow('inference failed');await vi.advanceTimersByTimeAsync(1);await rejected;expect(s.track.stop).toHaveBeenCalled();
  });
  it('handles disconnect and cancel during recording',async()=>{
    for(const action of ['disconnect','cancel']){const s=setup();await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow();if(action==='disconnect')s.track.dispatchEvent(new Event('ended'));else s.controller.cancel();await rejected;expect(s.track.stop).toHaveBeenCalled();expect(s.detector.close).toHaveBeenCalled();}
  });
  it('times out a recorder that never stops and stops camera immediately',async()=>{
    const s=setup();s.recorder.stop.mockImplementation(()=>{});await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(400);s.controller.stop();expect(s.track.stop).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(5000);await rejected;
  });
  it('rejects too short and empty recordings, and caps recording time',async()=>{
    const short=setup();await short.controller.open(short.video);const rejected=expect(short.controller.record()).rejects.toThrow('Not enough');await vi.advanceTimersByTimeAsync(1);short.controller.stop();await rejected;
    const empty=setup();empty.recorder.stop.mockImplementation(()=>{empty.recorder.state='inactive';empty.recorder.onstop?.();});await empty.controller.open(empty.video);const rejectedEmpty=expect(empty.controller.record()).rejects.toThrow('empty video');await vi.advanceTimersByTimeAsync(500);empty.controller.stop();await rejectedEmpty;
    const cap=setup();await cap.controller.open(cap.video);const result=cap.controller.record();await vi.advanceTimersByTimeAsync(20001);expect((await result).clip.source.duration).toBeCloseTo(20);expect(cap.track.stop).toHaveBeenCalled();
  });
});
