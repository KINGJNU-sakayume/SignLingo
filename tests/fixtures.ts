import { neutralRotations } from '../src/motion/reconstruct';
import { MODELS,SPACES,type Detection,type Landmark,type MotionClip } from '../src/motion/types';
export const lm=(x:number,y:number,z=0):Landmark=>({x,y,z,visibility:0.95,presence:0.95});
export function detection(timestamp=0):Detection {
  const body=Array.from({length:33},()=>lm(0.5,0.5));
  body[11]=lm(0.65,0.3);body[12]=lm(0.35,0.3);body[13]=lm(0.75,0.5);body[14]=lm(0.25,0.5);body[15]=lm(0.7,0.6);body[16]=lm(0.3,0.6);body[23]=lm(0.6,0.75);body[24]=lm(0.4,0.75);
  const world=body.map(p=>({...p,x:(p.x-0.5)*1.3,y:(p.y-0.75)*1.3}));
  const hands=[1,-1].map(sign=>{
    const points=Array.from({length:21},()=>lm(0,0,0));
    points[0]=lm(0,0,0);
    const offsets=[[-.027,.02],[-.027,.075],[-.008,.081],[.012,.075],[.029,.062]];
    for(let f=0;f<5;f++)for(let j=0;j<4;j++)points[1+f*4+j]=lm(sign*offsets[f][0],-offsets[f][1]-j*.02,0);
    return {world:points,image:points.map(p=>({...p,x:p.x+(sign===1?0.7:0.3),y:p.y+0.6})),label:sign===1?'Left':'Right',score:.96};
  });
  return {timestamp,body,bodyWorld:world,hands};
}
export function fixtureClip():MotionClip {
  return {schema:'signlingo.motion',version:1,language:'ksl',pipeline:{version:'test',detector:'synthetic-test-fixture-not-sign-language',models:MODELS},source:{name:'synthetic-fixture.webm',size:100,duration:1,width:640,height:480,mirrored:false,sampleHz:10},spaces:SPACES,nonmanual:{head:'not estimated in fixture',face:'not-estimated',linguisticValidation:'not-performed'},frames:[0,100,200].map(timestamp=>({...detection(timestamp),pose:{root:[0,1.3,0],rotations:neutralRotations(),quality:{body:.9,left:.9,right:.9,leftArm:.9,rightArm:.9,leftState:'tracked',rightState:'tracked'}},assignment:{left:0,right:1},warnings:[],corrections:[]})),edits:[]};
}
