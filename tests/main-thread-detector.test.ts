import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { MainThreadMediaPipeDetector } from '../src/motion/detector';
import { HAND_REGION_DEFAULTS } from '../src/motion/handRegions';
const mock=vi.hoisted(()=>({files:vi.fn(),pose:vi.fn(),hands:vi.fn()}));
vi.mock('@mediapipe/tasks-vision',()=>({FilesetResolver:{forVisionTasks:mock.files},PoseLandmarker:{createFromOptions:mock.pose},HandLandmarker:{createFromOptions:mock.hands}}));
const task=()=>({close:vi.fn(),detectForVideo:vi.fn(()=>({landmarks:[],worldLandmarks:[],handedness:[]}))});
beforeEach(()=>{vi.clearAllMocks();mock.files.mockResolvedValue({wasmLoaderPath:'data:text/javascript,export default function(){}'});mock.pose.mockResolvedValue(task());mock.hands.mockResolvedValue(task());});
afterEach(()=>vi.useRealTimers());
it('closes a pose that finishes initializing after cancellation',async()=>{
  const pose=task();let resolve!:(value:typeof pose)=>void;mock.pose.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const detector=new MainThreadMediaPipeDetector(),initializing=detector.initialize();const rejected=expect(initializing).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(mock.pose).toHaveBeenCalled());detector.close();resolve(pose);await rejected;expect(pose.close).toHaveBeenCalledOnce();expect(mock.hands).not.toHaveBeenCalled();
});
it('closes the first model when the second initialization fails',async()=>{
  const pose=task();mock.pose.mockResolvedValue(pose);mock.hands.mockRejectedValue(new Error('hand model failed'));const detector=new MainThreadMediaPipeDetector();await expect(detector.initialize()).rejects.toThrow('hand model failed');expect(pose.close).toHaveBeenCalledOnce();
});
it('closes a late second model and does not close the first twice',async()=>{
  const pose=task(),hands=task();mock.pose.mockResolvedValue(pose);let resolve!:(value:typeof hands)=>void;mock.hands.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const detector=new MainThreadMediaPipeDetector(),initializing=detector.initialize();const rejected=expect(initializing).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(mock.hands).toHaveBeenCalled());detector.close();resolve(hands);await rejected;expect(pose.close).toHaveBeenCalledOnce();expect(hands.close).toHaveBeenCalledOnce();
});
it('releases owned bitmap on inference failure and both models on close',async()=>{
  const pose=task(),hands=task();pose.detectForVideo.mockImplementation(()=>{throw new Error('inference failed');});mock.pose.mockResolvedValue(pose);mock.hands.mockResolvedValue(hands);
  const detector=new MainThreadMediaPipeDetector();await detector.initialize();const frame={close:vi.fn()} as unknown as ImageBitmap;await expect(detector.detect(frame,42)).rejects.toThrow('inference failed');expect(frame.close).toHaveBeenCalledOnce();detector.close();detector.close();expect(pose.close).toHaveBeenCalledOnce();expect(hands.close).toHaveBeenCalledOnce();
});
it('cancels queued main-thread inference before reading a frame',async()=>{
  const pose=task();mock.pose.mockResolvedValue(pose);const detector=new MainThreadMediaPipeDetector();await detector.initialize();
  const frame={close:vi.fn()} as unknown as ImageBitmap;const detecting=detector.detect(frame,42);const rejected=expect(detecting).rejects.toMatchObject({name:'AbortError'});detector.close();await rejected;expect(pose.detectForVideo).not.toHaveBeenCalled();expect(frame.close).toHaveBeenCalledOnce();
});
it('adds an IMAGE-mode crop landmarker for hand regions and fuses its hands into the detection',async()=>{
  const pose=task(),hands=task(),regions={close:vi.fn(),detect:vi.fn()};
  const body=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0}));
  Object.assign(body,{11:{x:.6,y:.35,z:0,visibility:.9},12:{x:.4,y:.35,z:0,visibility:.9},13:{x:.62,y:.75,z:0,visibility:.9},15:{x:.62,y:.55,z:0,visibility:.9}});
  pose.detectForVideo.mockReturnValue({landmarks:[body],worldLandmarks:[body],handedness:[]} as never);
  const crop=Array.from({length:21},(_,i)=>({x:.5,y:.6-i*.01,z:0}));
  regions.detect.mockReturnValue({landmarks:[crop],worldLandmarks:[crop],handedness:[[{categoryName:'Left',score:.91}]]});
  mock.pose.mockResolvedValue(pose);mock.hands.mockResolvedValueOnce(hands).mockResolvedValueOnce(regions);
  const context={clearRect:vi.fn(),drawImage:vi.fn()};
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>context})});
  try{
    const detector=new MainThreadMediaPipeDetector({handRegions:HAND_REGION_DEFAULTS});await detector.initialize();
    expect(mock.hands).toHaveBeenCalledTimes(2);expect(mock.hands.mock.calls[1][1]).toMatchObject({runningMode:'IMAGE',numHands:2});
    const frame={close:vi.fn(),width:700,height:466} as unknown as ImageBitmap,detail={close:vi.fn(),width:1400,height:932} as unknown as ImageBitmap;
    const result=await detector.detect(frame,7,detail);
    expect(context.drawImage.mock.calls[0][0]).toBe(detail);
    expect(result.hands).toHaveLength(1);expect(result.hands[0]).toMatchObject({origin:'region',label:'Left',score:.91});
    expect(detector.lastFusion).toMatchObject({source:{width:1400,height:932},candidates:{frame:0,region:1},kept:[{origin:'region',label:'Left',score:.91}],dropped:[]});
    expect(detector.lastFusion!.regions.left).not.toBeNull();expect(detector.lastFusion!.regions.right).toBeNull(); // no right wrist in this poseexpect('image' in result.hands[0]).toBe(true);
    expect(frame.close).toHaveBeenCalledOnce();expect(detail.close).toHaveBeenCalledOnce();
    detector.close();expect(regions.close).toHaveBeenCalledOnce();
  }finally{vi.unstubAllGlobals();}
});
