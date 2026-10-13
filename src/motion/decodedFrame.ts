import { seekDecoded } from './video';
// currentTime is a seek target, not the decoded frame's presentation timestamp.
// Register before seeking; repeated requests for a low-FPS frame may produce no
// new callback. Those requests are withheld, never re-counted as new evidence.
export async function seekPresentation(video:HTMLVideoElement,time:number,signal:AbortSignal):Promise<number|undefined> {
  if(!video.requestVideoFrameCallback){await seekDecoded(video,time,signal);return undefined;}
  let callback=0,timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{},unconfirmed:()=>void=()=>{};
  const observed=new Promise<number|undefined>(resolve=>{
    callback=video.requestVideoFrameCallback((_,metadata)=>resolve(metadata.mediaTime));
    unconfirmed=()=>resolve(undefined);
    abort=()=>resolve(undefined);signal.addEventListener('abort',abort,{once:true});
  });
  try {
    // A tiny in-frame offset avoids rounded seeks selecting the preceding frame.
    await seekDecoded(video,time+.0001,signal);
    // Decoding itself may be slow on phones. Only bound the wait for a
    // presentation callback AFTER seeked, not the time needed to decode.
    timer=setTimeout(unconfirmed,200);
    const timestamp=await observed;signal.throwIfAborted();return timestamp;
  }finally{clearTimeout(timer);video.cancelVideoFrameCallback(callback);signal.removeEventListener('abort',abort);}
}
export function identicalPixels(a:Uint8ClampedArray|undefined,b:Uint8ClampedArray){return !!a&&a.length===b.length&&a.every((value,i)=>value===b[i]);}
