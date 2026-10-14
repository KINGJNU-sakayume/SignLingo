import type { DisplayPose, MotionClip, Pose, Side, TemporalMotion } from './types';
import { sequenceBoundary } from './tracking';
import { boundWrist, eulerQuat, q, qa, rad } from './math';
export function frameIndex(clip: MotionClip, seconds: number) {
  return timestampIndex(clip.frames, seconds);
}
export function timestampIndex(frames: readonly { timestamp: number }[], seconds: number) {
  let lo=0, hi=frames.length-1;
  const ms=seconds*1000;
  while (lo<hi) { const mid=Math.ceil((lo+hi)/2); if (frames[mid].timestamp<=ms) lo=mid; else hi=mid-1; }
  return lo;
}
export function editedPose(clip: MotionClip, index: number, temporal?: TemporalMotion): DisplayPose {
  const original=temporal?.frames[index]?.pose ?? clip.frames[index].pose;
  const pose={...original, rotations:{...original.rotations}};
  for (const edit of clip.edits) if (edit.frame===index) {
    const key=`${edit.side}.wrist`;
    const delta=eulerQuat(...edit.degrees.map(rad) as [number,number,number]);
    const adjusted=q(pose.rotations[key]).multiply(delta).normalize();
    // Keep schema-1/0.1 playback semantics, but do not re-clamp preserved 0.2 palms
    // merely because the user saves an edit (including an explicit zero edit).
    pose.rotations[key]=qa(clip.pipeline.version==='0.2.0'?adjusted:boundWrist(adjusted).rotation);
  }
  return pose;
}
/** Which parts of a hand may be blended between two samples. */
export type BlendRules<P> = { hand: (pose: P, side: Side) => boolean; fingers: (pose: P, side: Side) => boolean };
/** Shared interpolation core: unavailable hands and fingers keep the earlier sample instead of inventing motion. */
export function blendPose<P extends DisplayPose>(a: P, b: P, t: number, rules: BlendRules<P>, rulesB: BlendRules<P> = rules): P {
  const rotations={...a.rotations};
  for (const key of Object.keys(rotations)) {
    const side=key.startsWith('left.')?'left':key.startsWith('right.')?'right':null;
    if (side) {
      if (!rules.hand(a,side) || !rulesB.hand(b,side)) continue;
      if (key.split('.').length===3 && (!rules.fingers(a,side)||!rulesB.fingers(b,side))) continue;
    }
    rotations[key]=qa(q(a.rotations[key]).slerp(q(b.rotations[key]),t));
  }
  return { ...a, rotations, root:a.root.map((x,k)=>x+(b.root[k]-x)*t) as Pose['root'] };
}
const evidenceRules: BlendRules<DisplayPose> = {
  hand: (pose, side) => pose.evidence ? ['observed','interpolated'].includes(pose.evidence[side].state) : pose.quality[`${side}State`]==='tracked',
  fingers: (pose, side) => pose.evidence?.[side].fingers!=='unavailable',
};
export function samplePose(clip: MotionClip, seconds: number, temporal?: TemporalMotion): DisplayPose {
  const i=frameIndex(clip,seconds), j=Math.min(i+1,clip.frames.length-1);
  const a=editedPose(clip,i,temporal), b=editedPose(clip,j,temporal);
  const gap=clip.frames[j].timestamp-clip.frames[i].timestamp;
  const t=gap>0 ? Math.max(0,Math.min(1,(seconds*1000-clip.frames[i].timestamp)/gap)) : 0;
  // Never interpolate across unreliable endpoints or long detection gaps.
  if (gap>200 || !a.quality.body || !b.quality.body || (j!==i&&sequenceBoundary(clip.frames[i],clip.frames[j]))) return a;
  return blendPose(a,b,t,evidenceRules);
}
// The HTMLVideoElement is the only clock when footage is attached.
export function playbackTime(video: Pick<HTMLVideoElement,'currentTime'> | null, standaloneSeconds: number) { return video ? video.currentTime : standaloneSeconds; }
