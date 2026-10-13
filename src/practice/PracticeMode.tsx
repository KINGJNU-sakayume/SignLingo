import { MediaPipeDetector } from '../motion/detector';
import { Reconstructor } from '../motion/reconstruct';
import { attemptTracking, inspectTracking } from './diagnostics';
import type { CaptureMeasurements, ExtractionMeasurements } from '../motion/timing';
import { CaptureQuality } from './CaptureQuality';
import { Overlay } from '../components/Overlay';
import { TrackingStatus } from './TrackingStatus';
import type { TrackingDiagnostics } from './diagnostics';
import { processPracticeVideo } from './fallback';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { importMotion } from '../motion/serialization';
import { editedPose, frameIndex } from '../motion/player';
import type { MotionClip, Side } from '../motion/types';
import { activeInterval, features } from './features';
import { compareMotion } from './compare';
import { WebcamCapture, cameraError } from './capture';
import { copy, feedbackText, metricRequirement, type Locale } from './copy';
import type { Comparison, Interval, PracticeSession } from './types';
import './practice.css';
type Phase = 'idle'|'opening'|'ready'|'countdown'|'recording'|'finishing'|'processing';
const seconds=(n:number)=>n.toFixed(2)+' s';
function Trim({clip,value,onChange,label,locale}:{clip:MotionClip;value:Interval;onChange:(v:Interval)=>void;label:string;locale:Locale}) {
  const t=copy[locale];
  return <fieldset className="practice-trim"><legend>{label} · {value.method}</legend>{(['start','end'] as const).map(key=><label key={key}>{key==='start'?t.startTime:t.endTime}<input aria-label={`${label} ${key==='start'?t.startTime:t.endTime}`} type="number" min={0} max={clip.frames.at(-1)!.timestamp/1000} step={.01} value={Number(value[key].toFixed(3))} onChange={e=>onChange({...value,[key]:Number(e.target.value),method:'manual'})}/></label>)}<button className="button secondary" onClick={()=>onChange(activeInterval(clip))}>{t.auto}</button></fieldset>;
}
function Alignment({result,index,locale}:{result:Comparison;index:number;locale:Locale}) {
  const t=copy[locale],r=result.referenceInterval,l=result.learnerInterval;
  const point=(p:Comparison['pairs'][number])=>`${30+340*(p.referenceTime-r.start)/Math.max(.001,r.end-r.start)},${160-130*(p.learnerTime-l.start)/Math.max(.001,l.end-l.start)}`;
  const selected=result.pairs[index]??result.pairs[0];
  return <svg className="practice-alignment" viewBox="0 0 400 200" role="img" aria-label={t.alignment}><path d="M30 25V160H375" fill="none" stroke="#728b94"/><polyline points={result.pairs.map(point).join(' ')} fill="none" stroke="#267b67" strokeWidth="3"/>{selected&&<circle cx={point(selected).split(',')[0]} cy={point(selected).split(',')[1]} r="5" fill="#ba4c83"/>}<text x="35" y="18">{t.learnerTime} {seconds(l.start)} – {seconds(l.end)}</text><text x="35" y="190">{t.refTime} {seconds(r.start)} – {seconds(r.end)}</text></svg>;
}
function WristPaths({reference,learner,result,side,index,locale}:{reference:MotionClip;learner:MotionClip;result:Comparison;side:Side;index:number;locale:Locale}) {
  const tracks=useMemo(()=>[features(reference),features(learner)],[reference,learner]);
  const intervals=[result.referenceInterval,result.learnerInterval];
  const use3D=tracks.every((track,k)=>{const selected=track.filter(f=>f.time>=intervals[k].start&&f.time<=intervals[k].end);return selected.filter(f=>f.hands[side]?.position).length/selected.length>=.65;});
  const point=(v:{x:number;y:number})=>`${200+v.x*65},${85-v.y*65}`;
  return <svg viewBox="0 0 400 260" className="practice-path" role="img" aria-label={copy[locale].path}>
    <text x="12" y="22" fontSize="12" fill="#45645a">{use3D?(locale==='ko'?'추정 3D 정면 투영':'Estimated 3D front projection'):(locale==='ko'?'측정 2D 영상 평면':'Measured 2D image plane')}</text>
    <path d="M167 85H233L225 150H175ZM200 65V45" fill="none" stroke="#9aadb5" strokeWidth="2"/>
    {tracks.map((track,k)=>{
      let previous=-Infinity;const commands:string[]=[];
      for(const f of track.filter(f=>f.time>=intervals[k].start&&f.time<=intervals[k].end)) {const hand=f.hands[side],position=use3D?hand?.position:hand?.position2D;if(!position){previous=-Infinity;continue;}commands.push(`${f.time-previous>.3?'M':'L'}${point(position)}`);previous=f.time;}
      const pair=result.pairs[index],hand=pair?track[k===0?pair.reference:pair.learner]?.hands[side]:undefined,position=use3D?hand?.position:hand?.position2D;
      return <g key={k}><path d={commands.join(' ')} fill="none" stroke={k?'#a76619':'#267b67'} strokeWidth="2.5" strokeDasharray={k?'5 4':undefined}/>{position&&<circle cx={point(position).split(',')[0]} cy={point(position).split(',')[1]} r="5" fill={k?'#a76619':'#267b67'}/>}</g>;
    })}
  </svg>;
}
export function PracticeMode() {
  const [locale,setLocale]=useState<Locale>(()=>navigator.language.startsWith('ko')?'ko':'en'),t=copy[locale];
  const [reference,setReference]=useState<MotionClip|null>(null),[learner,setLearner]=useState<MotionClip|null>(null);
  const [ri,setRi]=useState<Interval|null>(null),[li,setLi]=useState<Interval|null>(null);
  const [referenceUrl,setReferenceUrl]=useState(''),[learnerUrl,setLearnerUrl]=useState('');
  const [phase,setPhase]=useState<Phase>('idle'),[countdown,setCountdown]=useState(3),[error,setError]=useState('');
  const [mirror,setMirror]=useState(true),[unmirror,setUnmirror]=useState(false),[frames,setFrames]=useState(0),[elapsed,setElapsed]=useState(0),[attempt,setAttempt]=useState(0);
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[side,setSide]=useState<Side>('left'),[highlight,setHighlight]=useState<Side>();
  const live=useRef<HTMLVideoElement>(null),referenceVideo=useRef<HTMLVideoElement>(null),learnerVideo=useRef<HTMLVideoElement>(null);
  const [diagnostics,setDiagnostics]=useState<TrackingDiagnostics|null>(null),[progress,setProgress]=useState('');
  const [sampleHz,setSampleHz]=useState<15|30>(30),[maxDimension,setMaxDimension]=useState<640|960>(960);
  const [captureQuality,setCaptureQuality]=useState<CaptureMeasurements|null>(null),[analysis,setAnalysis]=useState<ExtractionMeasurements|null>(null);
  const [saved,setSaved]=useState<{file:File;duration?:number}|null>(null),[checking,setChecking]=useState(false);
  const framing=useRef<MediaPipeDetector|null>(null);
  const offline=useRef<AbortController|null>(null);
  const capture=useRef<WebcamCapture|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const busy=phase!=='idle'||checking, epoch=useRef(0);
  const comparison=useMemo(()=>{
    if(!reference||!learner||!ri||!li)return {result:null,error:''};
    try{return {result:compareMotion(reference,learner,ri,li),error:''};}catch(e){return {result:null,error:cameraError(e)};}
  },[reference,learner,ri,li]);
  const result=comparison.result;
  const session:PracticeSession|null=reference&&learner&&result?{schema:'signlingo.practice',version:1,attempt,reference,learner,comparison:result,linguisticValidation:'not-performed'}:null;
  const pair=result?.pairs[Math.min(index,result.pairs.length-1)];
  const rt=pair?.referenceTime??time,lt=pair?.learnerTime??0;
  const referenceMediaTime=rt+(reference?.source.timeOffset??0),learnerMediaTime=lt+(learner?.source.timeOffset??0);
  const rIndex=pair?.reference??(reference?frameIndex(reference,rt):0),lIndex=pair?.learner??(learner?frameIndex(learner,lt):0);
  const rPose=useMemo(()=>reference?editedPose(reference,rIndex):null,[reference,rIndex]);
  const lPose=useMemo(()=>learner?editedPose(learner,lIndex):null,[learner,lIndex]);
  useEffect(()=>()=>{epoch.current++;clearTimeout(timer.current);capture.current?.cancel();framing.current?.close();offline.current?.abort();},[]);
  useEffect(()=>()=>{if(referenceUrl)URL.revokeObjectURL(referenceUrl);},[referenceUrl]);
  useEffect(()=>()=>{if(learnerUrl)URL.revokeObjectURL(learnerUrl);},[learnerUrl]);
  useEffect(()=>{const end=()=>{if(document.hidden){if(capture.current||offline.current)setError('Video capture / processing interrupted because the page was hidden. Any completed recording is retained. Retry analysis when the page is visible.');epoch.current++;clearTimeout(timer.current);capture.current?.cancel();framing.current?.close();setChecking(false);offline.current?.abort();offline.current=null;capture.current=null;setPhase('idle');setPlaying(false);}};const leave=()=>{if(capture.current||offline.current)setError('Video capture interrupted when leaving the page. Retry the attempt.');epoch.current++;clearTimeout(timer.current);capture.current?.cancel();framing.current?.close();setChecking(false);offline.current?.abort();offline.current=null;capture.current=null;setPhase('idle');setPlaying(false);};document.addEventListener('visibilitychange',end);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',end);window.removeEventListener('pagehide',leave);};},[]);
  useEffect(()=>{setIndex(0);setPlaying(false);setHighlight(undefined);},[result]);
  useEffect(()=>{
    for(const [video,value] of [[referenceVideo.current,referenceMediaTime],[learnerVideo.current,learnerMediaTime]] as const)if(video&&video.readyState>=1&&Math.abs(video.currentTime-value)>.015)try{video.currentTime=value;}catch{/* The visible media error handler reports decoding failures. */}
  },[referenceMediaTime,learnerMediaTime,referenceUrl,learnerUrl]);
  useEffect(()=>{
    if(!playing||!reference)return;
    // Aligned playback advances through original reference times (learner follows the DTW map).
    const delay=result?Math.max(35,((result.pairs[index+1]?.referenceTime??rt+.1)-rt)*1000):100;
    const handle=setTimeout(()=>{
      if(result){if(index+1>=result.pairs.length)setPlaying(false);else setIndex(index+1);}
      else {const next=time+.1;if(next>reference.frames.at(-1)!.timestamp/1000)setPlaying(false);else setTime(next);}
    },delay);return()=>clearTimeout(handle);
  },[playing,reference,result,index,rt,time]);
  function endCamera(){epoch.current++;clearTimeout(timer.current);capture.current?.cancel();framing.current?.close();setChecking(false);offline.current?.abort();offline.current=null;capture.current=null;setPhase('idle');}
  function resetAttempt(){endCamera();setLearner(null);setLi(null);setLearnerUrl('');setError('');setFrames(0);setElapsed(0);setDiagnostics(null);setCaptureQuality(null);setAnalysis(null);setSaved(null);setIndex(0);setTime(0);setPlaying(false);}
  async function load(event:ChangeEvent<HTMLInputElement>,target:'reference'|'learner') {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;const current=++epoch.current;
    try {
      if(file.size>100*1024*1024)throw new Error('MotionClip exceeds 100 MB.');
      const clip=importMotion(await file.text());if(current!==epoch.current)return;
      if(clip.frames.length<3)throw new Error('Practice requires at least three motion frames.');
      setPlaying(false);setError('');setIndex(0);setTime(0);
      if(target==='reference'){resetAttempt();setReference(clip);setRi(activeInterval(clip));setReferenceUrl('');}
      else {resetAttempt();setLearner(clip);setLi(activeInterval(clip));setAttempt(n=>n+1);}
    } catch(e){if(current===epoch.current)setError(cameraError(e));}
  }
  async function openCamera() {
    setError('');setDiagnostics(null);setPlaying(false);setPhase('opening');
    const controller=new WebcamCapture(undefined,e=>{if(capture.current===controller&&e.name!=='AbortError'){epoch.current++;clearTimeout(timer.current);capture.current=null;setError(cameraError(e));setPhase('idle');}},m=>{if(capture.current===controller){setCaptureQuality(m);setElapsed(m.duration);setFrames(m.delivery.samples);}});capture.current=controller;
    try{await controller.open(live.current!);if(capture.current===controller)setPhase('ready');}
    catch(e){if(capture.current===controller){if(!(e instanceof Error&&e.name==='AbortError'))setError(cameraError(e));capture.current=null;setPhase('idle');}}
  }
  async function analyzeRecording(file:File,durationHint?:number) {
    const current=++epoch.current,controller=new AbortController();offline.current=controller;
    setPhase('processing');setLearner(null);setLi(null);setProgress('Decoding saved video…');setError('');setAnalysis(null);setDiagnostics(null);
    try {
      const clip=await processPracticeVideo(file,{mirrored:unmirror,signal:controller.signal,sampleHz,maxDimension,durationHint,
        progress:p=>{if(current===epoch.current)setProgress(`${p.phase}${p.total?` · ${p.done}/${p.total}`:''}`);},
        measurements:m=>{if(current===epoch.current)setAnalysis(m);},
        onFrame:(f,m)=>{if(current===epoch.current)setDiagnostics({model:'ready',backend:m.backend,fps:m.inferenceFps??0,...inspectTracking(f),frame:f,width:0,height:0});}
      });
      if(current!==epoch.current)return;
      setLearner(clip);setLi(activeInterval(clip));setDiagnostics(d=>d?{...d,attempt:attemptTracking(clip)}:d);
    }catch(e){if(current===epoch.current&&!(e instanceof Error&&e.name==='AbortError'))setError(cameraError(e));}
    finally{if(current===epoch.current){setPhase('idle');offline.current=null;}}
  }
  async function loadPhoneVideo(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    resetAttempt();setSaved({file});setLearnerUrl(URL.createObjectURL(file));setAttempt(n=>n+1);await analyzeRecording(file);
  }
  async function checkFraming(){
    const video=live.current;if(!video||!capture.current)return;
    const current=epoch.current,detector=new MediaPipeDetector();framing.current=detector;setChecking(true);setError('');
    try {
      await detector.initialize();if(current!==epoch.current)return;
      const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas is unavailable.');ctx.setTransform(unmirror?-1:1,0,0,1,unmirror?canvas.width:0,0);ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const start=performance.now(),frame=new Reconstructor().reconstruct(await detector.detect(canvas,0));
      if(current===epoch.current)setDiagnostics({model:'ready',backend:detector.id,fps:1000/(performance.now()-start),...inspectTracking(frame),frame,width:video.videoWidth,height:video.videoHeight});
    }catch(e){if(current===epoch.current&&!(e instanceof Error&&e.name==='AbortError'))setError(cameraError(e));}
    finally{detector.close();if(framing.current===detector)framing.current=null;if(current===epoch.current)setChecking(false);}
  }
  function beginCountdown() {
    const controller=capture.current;if(!controller)return;const current=++epoch.current;
    setLearner(null);setLi(null);setLearnerUrl('');setSaved(null);setAnalysis(null);setDiagnostics(null);setFrames(0);setElapsed(0);setPhase('countdown');setCountdown(3);
    let remaining=3;
    const tick=()=>{
      if(current!==epoch.current)return;
      remaining--;setCountdown(remaining);
      if(remaining>0){timer.current=setTimeout(tick,1000);return;}
      setPhase('recording');setAttempt(n=>n+1);
      void controller.record().then(recorded=>{
        if(current!==epoch.current)return;
        const file=new File([recorded.recording],recorded.recording.type.includes('mp4')?'local-webcam.mp4':'local-webcam.webm',{type:recorded.recording.type});
        const duration=recorded.measurements.duration;setSaved({file,duration});setCaptureQuality(recorded.measurements);setLearnerUrl(URL.createObjectURL(file));capture.current=null;void analyzeRecording(file,duration);
      },e=>{if(current===epoch.current){setPhase('idle');if(!(e instanceof Error&&e.name==='AbortError'))setError(cameraError(e));}});
    };timer.current=setTimeout(tick,1000);
  }
  return <main className="practice" lang={locale}>
    <div className="practice-heading"><div><p className="eyebrow">SIGNLINGO / PRACTICE · 0.3</p><h1>{t.title}</h1><p>{t.intro}</p></div><label>Language / 언어 <select aria-label="Practice language" value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="en">English</option><option value="ko">한국어</option></select></label></div>
    <p className="practice-notice">{t.privacy}</p><p className="practice-notice">{t.caveat}</p>
    {error&&<div role="alert" className="error-message"><div><strong>{t.failure}</strong><p>{locale==='ko'?`${t.details}: `:''}{error}</p></div></div>}
    <section className="practice-card practice-files"><label>{t.load}<input aria-label={t.load} type="file" accept="application/json,.json" disabled={busy} onChange={e=>void load(e,'reference')}/></label>{reference&&<><span>{reference.source.name}</span><label>{t.video}<input aria-label={t.video} type="file" accept="video/*" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.name!==reference.source.name||f.size!==reference.source.size){setError(locale==='ko'?'기준 JSON의 파일명·크기와 일치하는 원본 영상을 선택하세요.':'Choose the original video matching the reference JSON filename and size.');return;}setReferenceUrl(URL.createObjectURL(f));setError('');}}/></label></>}</section>
    <section className="practice-card"><h2>{t.learner}</h2><p>{phase==='opening'?t.loading:phase==='ready'?t.ready:phase==='recording'?`${t.recording} · ${elapsed.toFixed(1)} s · ${frames} ${t.frames}`:phase==='finishing'?t.finishing:phase==='processing'?progress:t.idle}</p>
      <div className="practice-camera" hidden={phase==='idle'||phase==='processing'} style={{aspectRatio:captureQuality?.width?`${captureQuality.width}/${captureQuality.height}`:undefined}}><video ref={live} muted playsInline aria-label="Live camera preview" style={{transform:mirror?'scaleX(-1)':undefined}}/>{diagnostics?.frame&&<Overlay frame={diagnostics.frame} width={diagnostics.width} height={diagnostics.height} mirrored={mirror!==unmirror} minConfidence={.6}/ >}{phase==='countdown'&&<strong className="practice-countdown" role="status" aria-live="assertive">{countdown}</strong>}</div>
      {diagnostics&&<>{phase==='ready'&&<p>{locale==='ko'?'녹화 전 화면 확인 결과입니다. 녹화 중에는 추론하지 않습니다.':'Framing snapshot before recording. Inference is disabled during recording.'}</p>}<TrackingStatus value={diagnostics} locale={locale}/></>}
      <CaptureQuality capture={captureQuality} analysis={analysis} locale={locale}/>
      <div className="practice-controls"><label>{locale==='ko'?'저장 영상 분석 속도':'Offline sampling request'}<select aria-label="Offline analysis sampling" value={sampleHz} disabled={busy} onChange={e=>setSampleHz(Number(e.target.value) as 15|30)}><option value={30}>30 Hz</option><option value={15}>15 Hz</option></select></label><label>{locale==='ko'?'분석 해상도':'Analysis maximum dimension'}<select aria-label="Analysis maximum dimension" value={maxDimension} disabled={busy} onChange={e=>setMaxDimension(Number(e.target.value) as 640|960)}><option value={960}>960 px</option><option value={640}>640 px</option></select></label></div>
      {saved&&!busy&&<div className="practice-controls"><button className="button secondary" onClick={()=>void analyzeRecording(saved.file,saved.duration)}>{locale==='ko'?'저장 영상 다시 분석':'Analyze saved recording again'}</button><a className="button secondary" href={learnerUrl} download={saved.file.name}>{locale==='ko'?'녹화 원본 저장':'Save original recording'}</a></div>}
      <div className="practice-controls"><label><input type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)}/>{t.preview}</label><label><input type="checkbox" checked={unmirror} disabled={busy&&phase!=='ready'} onChange={e=>setUnmirror(e.target.checked)}/>{t.pixels}</label></div><p>{t.previewNote}</p>
      <div className="practice-controls">{phase==='idle'&&<button className="button primary" disabled={!reference} onClick={()=>void openCamera()}>{t.camera}</button>}{phase==='ready'&&<><button className="button secondary" disabled={checking} onClick={()=>void checkFraming()}>{checking?(locale==='ko'?'화면 확인 중…':'Checking framing…'):(locale==='ko'?'손·상체 화면 확인 (선택)':'Check framing (optional)')}</button><button className="button primary" disabled={checking} onClick={beginCountdown}>{t.start}</button></>}{phase==='recording'&&<button className="button primary" onClick={()=>{setPhase('finishing');capture.current?.stop();}}>{t.stop}</button>}{busy&&<button className="button secondary" onClick={endCamera}>{t.cancel}</button>}{learner&&!busy&&<button className="button secondary" onClick={resetAttempt}>{t.retry}</button>}</div>
      {reference&&!busy&&<div className="practice-fallback"><label>{locale==='ko'?'휴대폰으로 녹화하거나 영상 선택':'Record or choose a phone video'}<input aria-label="Record or choose a phone video" type="file" accept="video/*" capture="user" onChange={e=>void loadPhoneVideo(e)}/></label><p>{locale==='ko'?'최대 20초 · 100 MB. 휴대폰 카메라로 녹화한 뒤 브라우저에서 처리합니다. 모델은 첫 사용 시 다운로드되며 영상은 업로드하지 않습니다.':'Up to 20 seconds · 100 MB. Record with the phone camera, then process locally. Both capture methods analyze after recording. Models download on first use; video is never uploaded.'}</p></div>}
      {reference&&!busy&&<details><summary>{t.loadAttempt}</summary><input aria-label={t.loadAttempt} type="file" accept="application/json,.json" onChange={e=>void load(e,'learner')}/></details>}
    </section>
    {reference&&<>
      <div className="practice-viewers">{([{name:t.reference,pose:rPose,url:referenceUrl,ref:referenceVideo},{name:t.learner,pose:lPose,url:learnerUrl,ref:learnerVideo}]).map((panel,k)=><section className="practice-card" key={k}><h2>{panel.name} · {seconds(k?lt:rt)}</h2><div className="practice-avatar"><Avatar pose={panel.pose} skeleton={false} markers={!!highlight} preset="front" highlightSide={highlight}/></div>{panel.url?<video ref={panel.ref} src={panel.url} muted playsInline preload="auto" aria-label={`${panel.name} video`} onLoadedMetadata={()=>{if(panel.ref.current)panel.ref.current.currentTime=k?learnerMediaTime:referenceMediaTime;}} onError={()=>setError(locale==='ko'?'연결한 영상을 재생할 수 없습니다. 3D 동작은 계속 확인할 수 있습니다.':'The attached video could not be decoded. The 3D motion remains available.')}/>:<p>{k?(learner?`${learner.frames.length} ${t.frames}`:t.idle):t.noVideo}</p>}</section>)}</div>
      <p>{t.raw}</p>
      <section className="practice-card"><div className="practice-controls"><button className="button secondary" onClick={()=>{if(!playing){if(result&&index>=result.pairs.length-1)setIndex(0);if(!result&&time>=reference.frames.at(-1)!.timestamp/1000)setTime(0);}setPlaying(!playing);}}>{playing?t.pause:t.play}</button><label className="practice-seek">{t.seek}<input aria-label={t.seek} type="range" min={0} max={result?result.pairs.length-1:reference.frames.at(-1)!.timestamp/1000} step={result?1:.01} value={result?index:time} onChange={e=>{setPlaying(false);if(result)setIndex(Number(e.target.value));else setTime(Number(e.target.value));}}/></label></div></section>
      <section className="practice-card"><h2>{t.intervals}</h2><p>{t.intervalNote}</p>{ri&&<Trim clip={reference} value={ri} onChange={setRi} label={t.reference} locale={locale}/ >}{learner&&li&&<Trim clip={learner} value={li} onChange={setLi} label={t.learner} locale={locale}/ >}{comparison.error&&<p role="alert">{comparison.error}</p>}</section>
    </>}
    {session&&result&&learner&&reference&&<div className="practice-results" data-attempt={session.attempt}>
      <section className="practice-card"><h2>{t.alignment}</h2><p>{t.alignmentNote}</p><Alignment result={result} index={index} locale={locale}/><h3>{t.timing}</h3><p>{t.speedRatio}: <strong>{result.durationRatio.toFixed(2)}×</strong> · {t.warp}: <strong>{(result.maxWarp*100).toFixed(1)}%</strong></p><p>{t.timingNote}</p></section>
      <section className="practice-card"><h2>{t.metrics}</h2>{result.evidence==='limited'&&<p className="practice-notice">{locale==='ko'?'일부 항목은 근거가 부족합니다. 관측된 항목은 개별적으로 표시하며 측정 불가능한 항목은 점수를 표시하지 않습니다.':'Some components have insufficient evidence. Supported components remain available; unavailable components are not scored.'}</p>}<p>{t.metricNote}</p><div className="practice-metrics">{result.metrics.map(m=><article key={`${m.side}-${m.component}`}><h3>{t[m.component]}</h3><span>{m.side?t[m.side]:t.both}</span><strong>{m.value===null?(m.component==='direction'?t.noDirection:t.missingValue):`${m.value.toFixed(m.unit==='degrees'?1:3)} ${m.unit==='degrees'?t.degrees:t.body}`}</strong><small>{m.space==='image2d'?(locale==='ko'?'2D 영상 평면 · 깊이 미측정':'2D image plane · no depth'):m.space==='estimated3d'?(locale==='ko'?'추정 3D · 깊이 불확실':'Estimated 3D · depth uncertain'):(locale==='ko'?'손 기준 각도':'Hand-local angles')}</small><small>{Math.round(m.coverage*100)}% {t.coverage} · n={m.samples}</small>{m.image&&m.space!=='image2d'&&<small>{locale==='ko'?'2D 영상 평면':'2D image plane'}: {m.image.value===null?'—':m.image.value.toFixed(3)} · {Math.round(m.image.coverage*100)}%</small>}{m.reason&&<small>{metricRequirement(locale,m.component,m.space==='image2d')}</small>}</article>)}</div></section>
      <section className="practice-card"><h2>{t.observed}</h2>{!result.feedback.some(f=>f.kind==='observed')&&<p>{t.noClaims}</p>}{(['observed','tracking'] as const).map(kind=><div key={kind}>{kind==='tracking'&&<h3>{t.tracking}</h3>}{result.feedback.filter(f=>f.kind===kind).map((f,i)=><button className={`practice-feedback ${kind}`} key={i} onClick={()=>{setPlaying(false);setIndex(f.pair);setHighlight(f.side);setSide(f.side);}}>{feedbackText(locale,f.key,f.side)} <span>{t.reference} {seconds(result.pairs[f.pair].referenceTime)} ↔ {t.learner} {seconds(result.pairs[f.pair].learnerTime)}</span></button>)}</div>)}<h3>{t.meaning}</h3><p>{t.meaningNote}</p></section>
      <section className="practice-card"><h2>{t.path}</h2><p>{t.pathNote}</p><select aria-label="Path hand" value={side} onChange={e=>setSide(e.target.value as Side)}><option value="left">{t.left}</option><option value="right">{t.right}</option></select><WristPaths reference={reference} learner={learner} result={result} side={side} index={index} locale={locale}/></section>
    </div>}
    <footer><p>{t.safari} </p></footer>
  </main>;
}
