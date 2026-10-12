import { Quaternion, Vector3 } from 'three';
import { alignHand, clamp, eulerQuat, rad } from './math';
import { palmFrame } from './hand';
import { SIDES, type MotionClip } from './types';
// Re-evaluate the old thresholds without applying them, then measure the old
// replacement-parent convention with all clamps disabled. This isolates frame
// composition from limit policy on the SAME baseline-assigned observations.
export function fingerAblation(original: MotionClip) {
  let oldFrameViolations=0,correctFrameViolations=0,segments=0,errorSum=0,errorMax=0;
  const kinds={flex:0,spread:0};
  for(const frame of original.frames)for(const side of SIDES){
    const index=frame.assignment[side];
    if(index===undefined||frame.pose.quality[`${side}State`]!=='tracked')continue;
    const hp=alignHand(frame.hands[index].world,new Vector3());
    const palm=hp&&palmFrame(hp,side)?.rotation;
    if(!hp||!palm)continue;
    for(let f=0;f<5;f++){
      let oldParent=palm.clone();
      const emittedOldParent=palm.clone(),correctParent=palm.clone();
      for(let j=0;j<3;j++){
        const source=hp[2+4*f+j].clone().sub(hp[1+4*f+j]);
        if(source.lengthSq()<1e-8)break;
        source.normalize();
        for(const [label,parent]of [['old',oldParent],['correct',correctParent]] as const){
          const local=source.clone().applyQuaternion(parent.clone().invert());
          const flex=Math.atan2(local.z,local.y),spread=-Math.atan2(local.x,Math.hypot(local.y,local.z));
          const flexMin=f===0?-25:j===0?-15:0,flexMax=j===0?95:115,spreadLimit=j===0?f===0?75:25:5;
          const violations=[Math.abs(flex-clamp(flex,rad(flexMin),rad(flexMax)))>rad(2),Math.abs(spread-clamp(spread,rad(-spreadLimit),rad(spreadLimit)))>rad(2)];
          if(label==='old'){
            oldFrameViolations+=violations.filter(Boolean).length;kinds.flex+=Number(violations[0]);kinds.spread+=Number(violations[1]);
            emittedOldParent.multiply(eulerQuat(flex,0,spread));
            const error=new Vector3(0,1,0).applyQuaternion(emittedOldParent).angleTo(source)*180/Math.PI;
            errorSum+=error;errorMax=Math.max(errorMax,error);segments++;
          }else{correctFrameViolations+=violations.filter(Boolean).length;correctParent.multiply(eulerQuat(flex,0,spread));}
        }
        oldParent=palm.clone().multiply(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),source.clone().applyQuaternion(palm.clone().invert())));
      }
    }
  }
  return {segments,oldFrameViolations,correctFrameViolations,kinds,unboundedOldDirectionMeanDegrees:segments?errorSum/segments:null,unboundedOldDirectionMaxDegrees:segments?errorMax:null};
}
