import { expect,it } from 'vitest';
import { Vector3 } from 'three';
import { optimizePoleWindow } from '../src/motion/temporal';
it('reduces weak pole jitter while preserving high-confidence turns exactly',()=>{
  const observations=[0,.15,-.18,.1,0].map((angle,i)=>({timestamp:i*33,direction:new Vector3(Math.cos(angle),Math.sin(angle),0),weight:i===0||i===4?1:.1}));
  const fitted=optimizePoleWindow(observations,2)!;
  expect(fitted.angleTo(new Vector3(1,0,0))).toBeLessThan(.05);
  observations[2].weight=1;expect(optimizePoleWindow(observations,2)!.angleTo(observations[2].direction)).toBeLessThan(1e-7);
});
it('does not fill wholly missing windows or use future evidence across a gap',()=>{
  expect(optimizePoleWindow([{timestamp:0,direction:new Vector3(),weight:0}],0)).toBeNull();
  const f=[{timestamp:0,direction:new Vector3(1,0,0),weight:.2},{timestamp:1000,direction:new Vector3(0,1,0),weight:1}];
  expect(optimizePoleWindow(f,0)!.x).toBeCloseTo(1);
});
it('exposes sign-distorting lag when a genuine turn is given low confidence',()=>{
  const observations=[0,0,Math.PI/2,Math.PI/2,Math.PI/2].map((a,i)=>({timestamp:i*33,direction:new Vector3(Math.cos(a),Math.sin(a),0),weight:.1}));
  expect(optimizePoleWindow(observations,2)!.angleTo(observations[2].direction)).toBeGreaterThan(.2);
});
