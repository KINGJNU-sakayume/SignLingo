// Analytic geometry fixtures only. These are NOT signing or KSL examples.
import { Quaternion, Vector3 } from 'three';
import { detection, lm } from './fixtures';
import type { Detection, Side } from '../src/motion/types';
export function articulatedDetection(options: { timestamp?:number; flex?:number[]; spread?:number; palm?:Quaternion; thumb?:boolean; mirror?:boolean } = {}): Detection {
  const frame = detection(options.timestamp);
  const flex = options.flex ?? [.8,.9,.5], spread = options.spread ?? .35;
  for (const [handIndex,side] of (['left','right'] as Side[]).entries()) {
    const hand = frame.hands[handIndex];
    const points = hand.world.map(p=>new Vector3(p.x,-p.y,-p.z));
    const sign = side === 'left' ? 1 : -1;
    points[9].x = 0; // Define an analytic palm +Y independent of procedural rig offsets.
    // Construct independent analytic planar phalanges with known cumulative flexion.
    // Abduction is confined to MCP and rotates the common flexion plane.
    for(let f=0;f<5;f++) {
      const start=1+4*f;
      let angle=0;
      const abduction = f===0 && options.thumb ? sign*1.45 : sign*spread;
      for(let j=0;j<3;j++) {
        angle+=flex[j];
        const direction = new Vector3(-Math.sin(abduction)*Math.cos(angle),Math.cos(abduction)*Math.cos(angle),Math.sin(angle));
        points[start+j+1]=points[start+j].clone().addScaledVector(direction,.025);
      }
    }
    const palm=options.palm??new Quaternion();
    hand.world=points.map(p=>{p.applyQuaternion(palm); if(options.mirror)p.x*=-1;return lm(p.x,-p.y,-p.z);});
  }
  return frame;
}
