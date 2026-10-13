// Purely synthetic trajectories and articulated hands. Not a KSL benchmark.
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { fixtureClip } from './fixtures';
import { Reconstructor } from '../src/motion/reconstruct';
import type { MotionClip } from '../src/motion/types';
// `lift` scales the vertical wrist travel (negative raises the hand); `swap` moves the right hand more.
export function practiceClip(options:{duration?:number;count?:number;endPhase?:number;reverse?:boolean;idle?:boolean;lift?:number;swap?:boolean}={}):MotionClip {
  const clip=fixtureClip(),count=options.count??31,duration=options.duration??2;
  const reconstruction=new Reconstructor();
  clip.source={...clip.source,name:'synthetic-practice-not-KSL',duration:duration+.01,sampleHz:(count-1)/duration};
  clip.frames=Array.from({length:count},(_,i)=>{
    let phase=i/(count-1)*(options.endPhase??1);if(options.reverse)phase=1-phase;
    if(options.idle)phase=Math.max(0,Math.min(1,(phase-.3)/.4));
    const detection=articulatedDetection({timestamp:i/(count-1)*duration*1000,flex:[.1+phase*.9,.2+phase*.6,.15],palm:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),phase*.8)});
    // Asymmetric motion makes an anatomical left/right swap observable.
    for(const [wrist,sign] of [[15,1],[16,-1]]) {
      const major=(sign===1)!==!!options.swap,lift=options.lift??1;
      detection.bodyWorld[wrist].y-=phase*(major?.35:.09)*lift;
      detection.bodyWorld[wrist].z-=Math.sin(phase*Math.PI)*(major?.15:.05);
      detection.body[wrist].y-=phase*(major?.2:.05)*lift;
      detection.hands[sign===1?0:1].image[0]={...detection.body[wrist]};
    }
    return reconstruction.reconstruct(detection);
  });return clip;
}
