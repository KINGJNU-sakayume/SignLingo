import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { MainThreadMediaPipeDetector } from '../src/motion/detector';
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
