import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const input=option('--motion'),output=option('--output')??'work/evaluation/proxies.json';
if(!input||!args.includes('--consent')){
  console.error('Usage: npm run evaluate -- --motion PRIVATE.motion.json --consent [--video PRIVATE.mp4] [--output work/evaluation/proxies.json]\nOnly use footage/detections you are permitted to evaluate. Outputs can contain sensitive derived measurements; keep them private.');process.exit(1);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try{
  const {importMotion}=await server.ssrLoadModule('/src/motion/serialization.ts');
  const {reconstructClip}=await server.ssrLoadModule('/src/motion/comparison.ts');
  const {inspectClip,pairedDirectionError}=await server.ssrLoadModule('/src/motion/diagnostics.ts');
  const {fingerAblation}=await server.ssrLoadModule('/src/motion/ablation.ts');
  const bytes=await readFile(input),clip=importMotion(bytes.toString());
  const originalClip=reconstructClip(clip,'original');
  const original=inspectClip(originalClip),improved=inspectClip(reconstructClip(clip,'improved'));
  const ablation=fingerAblation(originalClip);
  const report={format:'signlingo.evaluation',version:1,metricStatus:'All numeric metrics are proxies; this is NOT KSL validation.',consentedLocalEvaluation:true,linguisticReview:'not performed',groundTruth:'not supplied',inputMotionSha256:hash(bytes),inputVideoSha256:option('--video')?hash(await readFile(option('--video'))):null,detector:clip.pipeline.detector,models:clip.pipeline.models,source:{duration:clip.source.duration,width:clip.source.width,height:clip.source.height,sampleHz:clip.source.sampleHz,mirrored:clip.source.mirrored},pipelines:['0.1.0','0.2.0'],ablation,paired:pairedDirectionError(original,improved),original:original.summary,improved:improved.summary};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:output,paired:report.paired,originalCorrections:original.summary.correctionCount,improvedCorrections:improved.summary.correctionCount},null,2));
}finally{await server.close();}
