import type { MotionClip, Pose } from './types';
import { boundWrist, eulerQuat, q, qa, rad } from './math';
export function frameIndex(clip: MotionClip, seconds: number) {
  let lo=0, hi=clip.frames.length-1;
  const ms=seconds*1000;
  while (lo<hi) { const mid=Math.ceil((lo+hi)/2); if (clip.frames[mid].timestamp<=ms) lo=mid; else hi=mid-1; }
  return lo;
}
function editedPose(clip: MotionClip, index: number): Pose {
  const original=clip.frames[index].pose;
  const pose={...original, rotations:{...original.rotations}};
  for (const edit of clip.edits) if (edit.frame===index) {
    const key=`${edit.side}.wrist`;
    const delta=eulerQuat(...edit.degrees.map(rad) as [number,number,number]);
    pose.rotations[key]=qa(boundWrist(q(pose.rotations[key]).multiply(delta)).rotation);
  }
  return pose;
}
export function samplePose(clip: MotionClip, seconds: number): Pose {
  const i=frameIndex(clip,seconds), j=Math.min(i+1,clip.frames.length-1);
  const a=editedPose(clip,i), b=editedPose(clip,j);
  const gap=clip.frames[j].timestamp-clip.frames[i].timestamp;
  const t=gap>0 ? Math.max(0,Math.min(1,(seconds*1000-clip.frames[i].timestamp)/gap)) : 0;
  // Never interpolate across unreliable endpoints or long detection gaps.
  if (gap>200 || !a.quality.body || !b.quality.body) return a;
  const rotations={...a.rotations};
  for (const key of Object.keys(rotations)) {
    const side=key.startsWith('left.')?'left':key.startsWith('right.')?'right':null;
    if (side && (a.quality[`${side}State`] !== 'tracked' || b.quality[`${side}State`] !== 'tracked')) continue;
    rotations[key]=qa(q(a.rotations[key]).slerp(q(b.rotations[key]),t));
  }
  return { ...a, rotations, root:a.root.map((x,k)=>x+(b.root[k]-x)*t) as Pose['root'] };
}
// The HTMLVideoElement is the only clock when footage is attached.
export function playbackTime(video: Pick<HTMLVideoElement,'currentTime'> | null, standaloneSeconds: number) { return video ? video.currentTime : standaloneSeconds; }
