import { z } from 'zod';
import type { MotionClip } from './types';
import { neutralRotations } from './reconstruct';
const num=z.number().finite();
const point=z.object({x:num,y:num,z:num,visibility:num.min(0).max(1).optional(),presence:num.min(0).max(1).optional()});
const quat=z.tuple([num,num,num,num]).refine(a=>Math.abs(Math.hypot(...a)-1)<0.02,'Joint quaternion must be normalized');
const vec=z.tuple([num,num,num]);
const points=(count:number)=>z.array(point).refine(a=>a.length===0||a.length===count,`Expected 0 or ${count} landmarks`);
const quality=z.object({body:num.min(0).max(1),left:num.min(0).max(1),right:num.min(0).max(1),leftArm:num.min(0).max(1),rightArm:num.min(0).max(1),leftState:z.enum(['tracked','held','missing']),rightState:z.enum(['tracked','held','missing'])});
const unit=num.min(0).max(1);
// Optional 0.3.0 records. Schema 1 is unchanged: older readers strip these fields; 0.1.0/0.2.0 clips omit them.
const handRegions=z.object({enabled:z.boolean(),method:z.literal('pose-forearm-roi-v1'),cropSize:num.int().min(64).max(1024),sizeToForearm:num.positive().max(10),centerAlongHand:num.min(0).max(2),minShoulderFraction:num.min(0).max(5),minWristConfidence:unit,minGuideConfidence:unit,minRegionPixels:num.min(0).max(4096),cropSourceMaxDimension:num.int().min(64).max(16384),
  fusion:z.object({rule:z.literal('max-score-landmark-nms'),sameHand:num.min(0).max(10),sameHandOppositeLabel:num.min(0).max(10),maxHands:num.int().min(1).max(2)}),
  landmarker:z.object({runningMode:z.literal('IMAGE'),numHands:num.int().min(1).max(2),minHandDetectionConfidence:unit,minHandPresenceConfidence:unit})});
const temporal=z.object({algorithm:z.literal('conservative-bidirectional-v1'),maxGapMs:num.min(0).max(150),applies:z.literal('learner-display')});
const frame=z.object({timestamp:num.min(0),discontinuity:z.literal('cut').optional(),body:points(33),bodyWorld:points(33),hands:z.array(z.object({image:z.array(point).length(21),world:z.array(point).length(21),label:z.string().max(30),score:num.min(0).max(1),origin:z.enum(['frame','region']).optional()})).max(2),pose:z.object({root:vec,rotations:z.record(z.string(),quat).refine(r=>Object.keys(neutralRotations()).every(k=>k in r)&&Object.keys(r).length===Object.keys(neutralRotations()).length,'Unexpected rig joints'),quality}),warnings:z.array(z.string().max(500)).max(200),corrections:z.array(z.object({joint:z.string().max(80),kind:z.string().max(80),amount:num.min(0)})).max(200),assignment:z.object({left:z.number().int().min(0).max(1).optional(),right:z.number().int().min(0).max(1).optional()})});
const schema=z.object({schema:z.literal('signlingo.motion'),version:z.literal(1),language:z.literal('ksl'),pipeline:z.object({version:z.string().max(40),detector:z.string().max(100),models:z.record(z.string(),z.string().max(1000)),handRegions:handRegions.optional(),temporal:temporal.optional()}),source:z.object({name:z.string().max(500),size:num.min(0),duration:num.positive().max(120),timeOffset:num.min(0).max(120).optional(),width:num.int().positive().max(16384),height:num.int().positive().max(16384),mirrored:z.boolean(),sampleHz:num.min(1).max(60)}),spaces:z.object({image:z.string().max(2000),body:z.string().max(2000),hand:z.string().max(2000),avatar:z.string().max(2000),alignment:z.string().max(2000)}),nonmanual:z.object({head:z.string().max(1000),face:z.literal('not-estimated'),linguisticValidation:z.literal('not-performed')}),frames:z.array(frame).min(1).max(7200),edits:z.array(z.object({frame:z.number().int().min(0),side:z.enum(['left','right']),degrees:z.tuple([num.min(-45).max(45),num.min(-45).max(45),num.min(-45).max(45)])})).max(14400)});
export function importMotion(text:string):MotionClip {
  if(text.length>100*1024*1024)throw new Error('Motion JSON exceeds the 100 MB limit.');
  const clip=schema.parse(JSON.parse(text));
  if(clip.frames.some((f,i)=>f.timestamp>=clip.source.duration*1000+1||(i>0&&f.timestamp<=clip.frames[i-1].timestamp))) throw new Error('Motion timestamps must increase strictly and lie within video duration.');
  if(clip.frames[0].timestamp!==0)throw new Error('Motion must start at timestamp zero.');
  if(clip.edits.some(e=>e.frame>=clip.frames.length))throw new Error('Wrist correction references a missing frame.');
  for (const f of clip.frames) for (const index of Object.values(f.assignment)) if(index!==undefined&&index>=f.hands.length)throw new Error('Hand assignment references missing data.');
  for (const f of clip.frames) if (f.assignment.left !== undefined && f.assignment.left === f.assignment.right) throw new Error('A hand detection cannot be assigned to both sides.');
  return clip;
}
export function exportMotion(clip:MotionClip) { return JSON.stringify(clip); }
export function downloadMotion(clip:MotionClip) {
  const url=URL.createObjectURL(new Blob([exportMotion(clip)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=clip.source.name.replace(/\.[^.]+$/,'')+'.motion.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
