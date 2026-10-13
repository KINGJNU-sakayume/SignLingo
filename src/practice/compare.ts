import { SIDES, type MotionClip, type Side } from '../motion/types';
import { activeInterval, palmDistance, selectedFeatures, shapeDistance, type Feature, type HandFeature } from './features';
import type { Comparison, Component, Feedback, Interval, Metric } from './types';
const mean = (xs: number[]) => xs.reduce((a,b)=>a+b,0)/xs.length;
// Engineering weights emphasize handshape and palm orientation. These are NOT KSL-calibrated.
function cost(a: Feature,b: Feature) {
  let sum=0, weight=0;
  for (const side of SIDES) {
    const x=a.hands[side],y=b.hands[side];
    if (!x || !y) {sum+=.75;weight++;continue;}
    const shape=shapeDistance(x,y);if(shape!==undefined){sum+=3*shape/90;weight+=3;}
    const palm=palmDistance(x,y);
    if(palm!==undefined){sum+=2*palm/180;weight+=2;}
    if(x.position&&y.position){sum+=Math.min(2,x.position.distanceTo(y.position));weight++;}
    else if(x.position2D&&y.position2D){sum+=Math.min(2,x.position2D.distanceTo(y.position2D));weight++;}
  }
  return weight?sum/weight:.75;
}
export function align(a: Feature[],b: Feature[]): [number,number][] {
  const n=a.length,m=b.length, dp = new Float64Array(n*m).fill(Infinity), parent = new Uint8Array(n*m);
  for (let i=0;i<n;i++) for (let j=0;j<m;j++) {
    // Irregular capture/analysis spacing must not change the temporal band.
    if (Math.abs((a[i].time-a[0].time)/(a.at(-1)!.time-a[0].time)-(b[j].time-b[0].time)/(b.at(-1)!.time-b[0].time))>.45) continue;
    const k=i*m+j, c=cost(a[i],b[j]);
    if (!i && !j) {dp[k]=c;continue;}
    // A small repeat penalty prevents gratuitous stretching of an incomplete gesture.
    const options=[i&&j?dp[(i-1)*m+j-1]:Infinity,i?dp[(i-1)*m+j]+.025:Infinity,j?dp[k-1]+.025:Infinity];
    const best=Math.min(...options);dp[k]=c+best;parent[k]=options.indexOf(best);
  }
  if (!Number.isFinite(dp[n*m-1])) throw new Error('The selected intervals could not be aligned.');
  const path: [number,number][]=[];let i=n-1,j=m-1;
  while(true) {path.push([i,j]);if(!i&&!j)break;const p=parent[i*m+j];if(p!==2)i--;if(p!==1)j--;}
  return path.reverse();
}
function priorMotion(fs:Feature[],i:number,side:Side,key:'position'|'position2D') {
  for(let j=i-1;j>=0;j--){
    if(fs[j+1].time-fs[j].time>.3||!fs[j].hands[side]?.[key])return undefined;
    const age=fs[i].time-fs[j].time;
    if(age>=.1-1e-6)return age<=.3?fs[j]:undefined;
  }
  return undefined;
}
export function compareMotion(reference: MotionClip,learner: MotionClip,referenceInterval: Interval=activeInterval(reference),learnerInterval: Interval=activeInterval(learner)): Comparison {
  const a=selectedFeatures(reference,referenceInterval),b=selectedFeatures(learner,learnerInterval),path=align(a,b);
  const pairs=path.map(([i,j])=>({reference:a[i].index,learner:b[j].index,referenceTime:a[i].time,learnerTime:b[j].time}));
  const metrics: Metric[]=[], feedback: Feedback[]=[];
  const support=(fs:Feature[],i:number)=>((i?Math.min(.3,fs[i].time-fs[i-1].time):0)+(i<fs.length-1?Math.min(.3,fs[i+1].time-fs[i].time):0))/2;
  function measureMetric(measure:(x:Feature,y:Feature)=>number|undefined) {
    let sum=0,totalWeight=0;const ai=new Set<number>(),bi=new Set<number>();
    const repeatsA=new Map<number,number>(),repeatsB=new Map<number,number>();
    path.forEach(([i,j])=>{repeatsA.set(i,(repeatsA.get(i)??0)+1);repeatsB.set(j,(repeatsB.get(j)??0)+1);});
    for(const [i,j] of path){const v=measure(a[i],b[j]);if(v!==undefined&&Number.isFinite(v)){
      const weight=(support(a,i)/repeatsA.get(i)!+support(b,j)/repeatsB.get(j)!)/2;
      sum+=v*weight;totalWeight+=weight;ai.add(i);bi.add(j);
    }}
    const coverage=Math.min(ai.size/a.length,bi.size/b.length,[...ai].reduce((v,i)=>v+support(a,i),0)/(a.at(-1)!.time-a[0].time),[...bi].reduce((v,i)=>v+support(b,i),0)/(b.at(-1)!.time-b[0].time),1);
    return {value:coverage>=.65&&ai.size>=3&&bi.size>=3&&totalWeight?sum/totalWeight:null,coverage,samples:Math.min(ai.size,bi.size)};
  }
  const requirements:Record<Component,string>={handshape:'Reliable hand identity, palm basis and all finger segments required.',palm:'Reliable shoulders and measured palm required; monocular depth is estimated.',position:'Reliable shoulders and wrist required; image-only results omit depth.',face:'Reliable shoulders, wrist and nose required; image-only results omit depth.',trajectory:'Reliable interval-start wrist and subsequent shoulder-relative positions required.',direction:'Consecutive moving wrist samples with no gap over 300 ms required.',coordination:'Reliable simultaneous left and right wrist positions relative to shoulders required.'};
  function metric(component:Component,side:Side|undefined,unit:Metric['unit'],measure:(x:Feature,y:Feature)=>number|undefined,imageMeasure?: (x:Feature,y:Feature)=>number|undefined) {
    const measured=measureMetric(measure),image=imageMeasure?measureMetric(imageMeasure):undefined;
    const useImage=measured.value===null&&image?.value!==null&&image?.value!==undefined;
    const result:Metric={component,side,unit,...(useImage?image!:measured),space:component==='handshape'?'hand':useImage?'image2d':'estimated3d',image,
      reason:measured.value===null?requirements[component]+' At least 3 distinct samples and 65% frame/time coverage per clip are needed.':undefined};
    metrics.push(result);return result;
  }
  for (const side of SIDES) {
    const paired = (measure:(x:HandFeature,y:HandFeature)=>number|undefined) => (x:Feature,y:Feature) => x.hands[side]&&y.hands[side]?measure(x.hands[side]!,y.hands[side]!):undefined;
    const shape=metric('handshape',side,'degrees',paired(shapeDistance));
    metric('palm',side,'degrees',paired(palmDistance));
    metric('position',side,'body',paired((x,y)=>x.position&&y.position?x.position.distanceTo(y.position):undefined),paired((x,y)=>x.position2D&&y.position2D?x.position2D.distanceTo(y.position2D):undefined));
    metric('face',side,'body',paired((x,y)=>x.face&&y.face?x.face.distanceTo(y.face):undefined),paired((x,y)=>x.face2D&&y.face2D?x.face2D.distanceTo(y.face2D):undefined));
    // Trajectory = displacement from interval start. Never extrapolate a missing start.
    const startA=a[0].hands[side],startB=b[0].hands[side];
    metric('trajectory',side,'body',paired((x,y)=>startA?.position&&startB?.position&&x.position&&y.position?x.position.clone().sub(startA.position).distanceTo(y.position.clone().sub(startB.position)):undefined),paired((x,y)=>startA?.position2D&&startB?.position2D&&x.position2D&&y.position2D?x.position2D.clone().sub(startA.position2D).distanceTo(y.position2D.clone().sub(startB.position2D)):undefined));
    const directions=(fs:Feature[])=>new Map(fs.map((f,i)=>{const prior=priorMotion(fs,i,side,'position'),hand=f.hands[side],old=prior?.hands[side];const v=hand?.position&&old?.position&&prior&&f.time-prior.time<=.3?hand.position.clone().sub(old.position):undefined;return [f.index,v&&v.length()>.015?v.normalize():undefined] as const;}));
    const ad=directions(a),bd=directions(b);
    const imageDirections=(fs:Feature[])=>new Map(fs.map((f,i)=>{const prior=priorMotion(fs,i,side,'position2D'),p=f.hands[side]?.position2D,old=prior?.hands[side]?.position2D,v=p&&old&&prior&&f.time-prior.time<=.3?p.clone().sub(old):undefined;return [f.index,v&&v.length()>.015?v.normalize():undefined] as const;}));
    const aid=imageDirections(a),bid=imageDirections(b);
    metric('direction',side,'degrees',(x,y)=>{const u=ad.get(x.index),v=bd.get(y.index);return u&&v?u.angleTo(v)*180/Math.PI:undefined;},(x,y)=>{const u=aid.get(x.index),v=bid.get(y.index);return u&&v?Math.acos(Math.max(-1,Math.min(1,u.dot(v))))*180/Math.PI:undefined;});
    if (shape.value===null || shape.coverage<.9) feedback.push({kind:'tracking',key:'missing',side,pair:Math.max(0,path.findIndex(([i,j])=>!a[i].hands[side]?.shape||!b[j].hands[side]?.shape))});
    // Specific claims require three distinct, consecutive frames on BOTH sides of the alignment.
    // This rejects isolated spikes and repeated DTW matches as evidence of a sustained difference.
    const claims: {key:Feedback['key']; value:(x:HandFeature,y:HandFeature)=>number|undefined; threshold:number}[]=[
      {key:'low',value:(x,y)=>x.position&&y.position?x.position.y-y.position.y:undefined,threshold:.16},
      {key:'palm',value:palmDistance,threshold:25},
      {key:'index',value:(x,y)=>x.bend&&y.bend?x.bend[1]-y.bend[1]:undefined,threshold:25},
      {key:'path',value:(x,y)=>startA?.position&&startB?.position&&x.position&&y.position?x.position.clone().sub(startA.position).distanceTo(y.position.clone().sub(startB.position)):0,threshold:.2},
    ];
    for(const claim of claims) {
      const component=({low:'position',palm:'palm',index:'handshape',path:'trajectory'} as const)[claim.key as 'low'|'palm'|'index'|'path'];
      if(!metrics.some(m=>m.side===side&&m.component===component&&m.value!==null&&m.space!=='image2d'))continue;
      let run: {i:number;j:number;k:number;value:number}[]=[];
      for(let k=0;k<path.length;k++) {
        const [i,j]=path[k],x=a[i].hands[side],y=b[j].hands[side],value=x&&y?claim.value(x,y):0,prev=run.at(-1);
        if (!x || !y || value===undefined || value<=claim.threshold) {run=[];continue;}
        if(prev&&(a[i].time-a[prev.i].time>.3 || b[j].time-b[prev.j].time>.3)) run=[];
        if(!run.length || (i>run.at(-1)!.i && j>run.at(-1)!.j))run.push({i,j,k,value});
        if(run.length>=3) {feedback.push({kind:'observed',key:claim.key,side,pair:run[0].k,value:mean(run.map(v=>v.value))});break;}
      }
    }
  }
  metric('coordination',undefined,'body',(x,y)=>x.hands.left?.position&&x.hands.right?.position&&y.hands.left?.position&&y.hands.right?.position?x.hands.left.position.clone().sub(x.hands.right.position).distanceTo(y.hands.left.position.clone().sub(y.hands.right.position)):undefined,(x,y)=>x.hands.left?.position2D&&x.hands.right?.position2D&&y.hands.left?.position2D&&y.hands.right?.position2D?x.hands.left.position2D.clone().sub(x.hands.right.position2D).distanceTo(y.hands.left.position2D.clone().sub(y.hands.right.position2D)):undefined);
  const da=a.at(-1)!.time-a[0].time,db=b.at(-1)!.time-b[0].time;
  return {referenceInterval,learnerInterval,pairs,metrics,feedback,durationRatio:db/da,maxWarp:Math.max(...path.map(([i,j])=>Math.abs((a[i].time-a[0].time)/da-(b[j].time-b[0].time)/db))),evidence:metrics.filter(m=>m.component!=='direction').every(m=>m.value!==null)?'sufficient':'limited'};
}
