// Mock camera/recorder lifecycle only; no claims about physical camera FPS.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {WebcamCapture,cameraError,recordingMime,type CapturePlatform} from '../src/practice/capture';
import {cadence} from '../src/motion/timing';
function setup(){
  const track=new EventTarget() as EventTarget&{stop:ReturnType<typeof vi.fn>;getSettings:()=>MediaTrackSettings};track.stop=vi.fn();track.getSettings=()=>({frameRate:30});
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream;
  const video={get currentTime(){return Date.now()/1000;},readyState:4,srcObject:null,videoWidth:320,videoHeight:240,play:vi.fn().mockResolvedValue(undefined)} as unknown as HTMLVideoElement;
  const recorder={state:'inactive',mimeType:'video/webm',onstop:null as null|(()=>void),onerror:null as null|(()=>void),ondataavailable:null as null|((e:{data:Blob})=>void),start:vi.fn(()=>{recorder.state='recording';}),stop:vi.fn(()=>{recorder.state='inactive';recorder.ondataavailable?.({data:new Blob(['synthetic bytes, not a real recording'])});recorder.onstop?.();})};
  const platform:CapturePlatform={camera:vi.fn().mockResolvedValue(stream),recorder:()=>recorder as unknown as MediaRecorder,now:()=>Date.now()};
  const failure=vi.fn(),measurements=vi.fn(),controller=new WebcamCapture(platform,failure,measurements);
  return {track,stream,video,recorder,platform,controller,failure,measurements};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
describe('recording-first capture, independent of inference',()=>{
  it('selects supported WebM or MP4',()=>{expect(recordingMime(t=>t==='video/mp4')).toBe('video/mp4');expect(recordingMime(()=>false)).toBeUndefined();});
  it('preserves video, measures delivery separately and releases camera before analysis',async()=>{
    const s=setup();await s.controller.open(s.video);const result=s.controller.record();await vi.advanceTimersByTimeAsync(600);s.controller.stop();
    const recorded=await result;expect(recorded.recording.size).toBeGreaterThan(0);expect(recorded).not.toHaveProperty('clip');
    expect(recorded.measurements).toMatchObject({requestedCameraFps:30,reportedTrackFps:30,encodedRecordingFps:null,duration:.6,deliveryMethod:'video-clock-poll'});
    expect(recorded.measurements.delivery.fps).toBeCloseTo(10); // poll rate, explicitly NOT encoded FPS
    expect(s.track.stop).toHaveBeenCalled();expect(s.video.srcObject).toBeNull();s.controller.cancel();expect(s.failure).not.toHaveBeenCalled();
  });
  it.each(['NotAllowedError','NotFoundError','NotReadableError'])('reports %s',async name=>{const s=setup();s.platform.camera=vi.fn().mockRejectedValue(new DOMException('',name));await expect(s.controller.open(s.video)).rejects.toMatchObject({name});expect(cameraError(new DOMException('',name))).toBeTruthy();});
  it('stops a stream that arrives after permission cancellation',async()=>{const s=setup();let resolve!:(s:MediaStream)=>void;s.platform.camera=()=>new Promise(r=>resolve=r);const opened=s.controller.open(s.video);s.controller.cancel();resolve(s.stream);await expect(opened).rejects.toMatchObject({name:'AbortError'});expect(s.track.stop).toHaveBeenCalled();});
  it.each(['play','recorder'])('releases camera on %s setup failure',async stage=>{const s=setup();if(stage==='play')s.video.play=vi.fn().mockRejectedValue(new Error('play failed'));else s.platform.recorder=()=>{throw new Error('unsupported');};await expect(s.controller.open(s.video)).rejects.toThrow();expect(s.track.stop).toHaveBeenCalled();});
  it('recorder errors release resources and permit a new attempt',async()=>{const s=setup();await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow('recording failed');s.recorder.onerror?.();await rejected;expect(s.track.stop).toHaveBeenCalled();const retry=setup();await retry.controller.open(retry.video);retry.controller.cancel();expect(retry.track.stop).toHaveBeenCalled();});
  it.each(['ended','mute','cancel'])('handles %s while recording',async action=>{const s=setup();await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow();if(action==='cancel')s.controller.cancel();else s.track.dispatchEvent(new Event(action));await rejected;expect(s.track.stop).toHaveBeenCalled();});
  it('times out recorder finalization while releasing camera immediately',async()=>{const s=setup();s.recorder.stop.mockImplementation(()=>{});await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(400);s.controller.stop();expect(s.track.stop).toHaveBeenCalled();await vi.advanceTimersByTimeAsync(5000);await rejected;});
  it('rejects short and empty files and caps duration',async()=>{
    const s=setup();await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow('too short');await vi.advanceTimersByTimeAsync(1);s.controller.stop();await rejected;
    const empty=setup();empty.recorder.stop.mockImplementation(()=>{empty.recorder.state='inactive';empty.recorder.onstop?.();});await empty.controller.open(empty.video);const failed=expect(empty.controller.record()).rejects.toThrow('empty');await vi.advanceTimersByTimeAsync(500);empty.controller.stop();await failed;
    const cap=setup();await cap.controller.open(cap.video);const result=cap.controller.record();await vi.advanceTimersByTimeAsync(20001);expect((await result).measurements.duration).toBe(20);
  });
  it('rejects frozen video and orientation changes',async()=>{
    for(const orientation of [false,true]){const s=setup();if(!orientation)Object.defineProperty(s.video,'currentTime',{value:0});await s.controller.open(s.video);const rejected=expect(s.controller.record()).rejects.toThrow(orientation?'orientation changed':'no new camera frames');if(orientation)Object.defineProperty(s.video,'videoWidth',{value:240});await vi.advanceTimersByTimeAsync(3000);await rejected;expect(s.track.stop).toHaveBeenCalled();}
  });
  it('uses presentation timestamps and exposes skipped callbacks/irregular delivery',()=>{const c=cadence([0,1/30,2/30,2/30,.2,.233],[1,2,3,3,7,8]);expect(c).toMatchObject({duplicateTimes:1,callbackSkips:3,largeGaps:1});expect(c.fps).not.toBe(30);expect(c.irregularIntervals).toBeGreaterThan(0);});
});
