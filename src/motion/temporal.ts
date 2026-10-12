import { Vector3 } from 'three';
import { clamp } from './math';
export type PoleObservation = { timestamp: number; direction: Vector3; weight: number };
// Experimental five-frame Euclidean least-squares fit, followed by unit projection.
// Strong evidence is a hard anchor. Occlusions/gaps form separate problems. This
// is NOT enabled in reconstruction: uncalibrated visibility weights can delay turns.
export function optimizePoleWindow(observations: PoleObservation[], index: number, lambda=.2): Vector3 | null {
  if (index < 0 || index >= observations.length) return null;
  let lo=Math.max(0,index-2),hi=Math.min(observations.length-1,index+2);
  for(let i=index;i>lo;i--)if(observations[i].timestamp-observations[i-1].timestamp>200||observations[i].timestamp<=observations[i-1].timestamp){lo=i;break;}
  for(let i=index;i<hi;i++)if(observations[i+1].timestamp-observations[i].timestamp>200||observations[i+1].timestamp<=observations[i].timestamp){hi=i;break;}
  const window=observations.slice(lo,hi+1),n=window.length;
  const weights=window.map(o=>o.direction.lengthSq()<1e-10?0:clamp(o.weight,0,1));
  if(!weights.some(w=>w>0))return null;
  if(weights[index-lo]>=.8)return observations[index].direction.clone().normalize();
  const data=window.map(o=>o.direction.clone().normalize());
  const solution=new Vector3();
  for(let axis=0;axis<3;axis++){
    const diagonal=weights.map((w,i)=>(w>=.8?1e6:w)+Math.max(0,lambda)*((i>0?1:0)+(i<n-1?1:0))+1e-9);
    const rhs=weights.map((w,i)=>(w>=.8?1e6:w)*data[i].getComponent(axis));
    const coupling=-Math.max(0,lambda);
    for(let i=1;i<n;i++){const factor=coupling/diagonal[i-1];diagonal[i]-=factor*coupling;rhs[i]-=factor*rhs[i-1];}
    const values=new Array<number>(n);values[n-1]=rhs[n-1]/diagonal[n-1];
    for(let i=n-2;i>=0;i--)values[i]=(rhs[i]-coupling*values[i+1])/diagonal[i];
    solution.setComponent(axis,values[index-lo]);
  }
  return solution.lengthSq()>1e-8?solution.normalize():null;
}
