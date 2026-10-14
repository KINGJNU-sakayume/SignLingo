import { useEffect,useMemo,useRef,useState, type ChangeEvent } from 'react';
import { Activity,ArrowDownToLine,ArrowUpFromLine,Box,Check,ChevronRight,FileVideo,Focus,Hand,Info,LoaderCircle,Pause,Play,RotateCcw,ScanLine,Upload,X } from 'lucide-react';
import { DiagnosticsLab, type PipelineView } from './components/DiagnosticsLab';
import { reconstructTemporalAsync } from './motion/temporalReconstruction';
import { reconstructClip } from './motion/comparison';
import { Avatar, type CameraView } from './components/Avatar';
import { handFocus, runDisplayPipeline, sampleDisplay, stabilizeTorso } from './motion/display';
import { activeRange, loopTime, NO_LOOP, type LoopRange } from './learn/loop';
import { Overlay } from './components/Overlay';
import { extractMotion } from './motion/extract';
import { EXPERIMENTAL_PIPELINE } from './motion/pipeline';
import { PIPELINE_VERSION } from './motion/types';
import type { Progress } from './motion/video';
import { downloadMotion,importMotion } from './motion/serialization';
import { frameIndex,playbackTime } from './motion/player';
import { SIDES,type DisplayPose,type MotionClip,type TemporalMotion,type Side,type Vec3 } from './motion/types';
import { koMessage, koState } from './i18n/ko';
const evidenceLabel={observed:'관측',interpolated:'시간 보간',held:'임시 유지',unavailable:'사용 불가'};
const VIEWS:[CameraView,string][]=[['front','정면'],['side','측면'],['first','1인칭'],['hands','손 확대']];
const timeLabel=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
export default function App({active=true}:{active?:boolean}){
  const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[clip,setClip]=useState<MotionClip|null>(null);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [overlay,setOverlay]=useState(true),[skeleton,setSkeleton]=useState(false),[markers,setMarkers]=useState(false),[view,setView]=useState<CameraView>('front'),[cameraReset,setCameraReset]=useState(0);
  // Diagnostic default: stored poses as reconstructed. "몸통 고정" previews the learner-screen torso display.
  const [steady,setSteady]=useState(false),[range,setRange]=useState<LoopRange>(NO_LOOP);
  const [mirrored,setMirrored]=useState(false),[handRegions,setHandRegions]=useState(false),[sampleHz,setSampleHz]=useState(30),[progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState('');
  const [correctionSide,setCorrectionSide]=useState<Side>('left'),[edit,setEdit]=useState<Vec3>([0,0,0]);
  const video=useRef<HTMLVideoElement>(null),upload=useRef<HTMLInputElement>(null),jsonInput=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null);
  const [temporal,setTemporal]=useState<TemporalMotion|null>(null),[temporalView,setTemporalView]=useState('enhanced'),[temporalProgress,setTemporalProgress]=useState<Progress|null>(null),[temporalRequest,setTemporalRequest]=useState(0);
  const temporalAbort=useRef<AbortController|null>(null);
  useEffect(()=>{
    setTemporal(null);setTemporalProgress(null);if(!clip||!active)return;
    const controller=new AbortController();temporalAbort.current=controller;
    reconstructTemporalAsync(clip,{signal:controller.signal,progress:setTemporalProgress}).then(result=>{if(!controller.signal.aborted)setTemporal(result);}).catch(e=>{if(!controller.signal.aborted)setError(`시간 복원 실패: ${koMessage(e instanceof Error?e.message:String(e))}`);}).finally(()=>{if(!controller.signal.aborted)setTemporalProgress(null);});
    return()=>controller.abort();
    // Edits are applied at playback, after either reconstruction.
  },[clip?.frames,active,temporalRequest]);
  const [technical,setTechnical]=useState(false),[pipelineView,setPipelineView]=useState<PipelineView>('stored');
  const comparisons=useMemo(()=>technical&&clip?{stored:clip,original:reconstructClip(clip,'original'),improved:reconstructClip(clip,'improved')}:null,[technical,clip]);
  const displayedClip=comparisons?comparisons[pipelineView]:clip;
  const clock=useRef(0);const busy=!!progress;
  const length=clip?.source.duration??duration;const offset=clip?.source.timeOffset??0;
  const index=clip?frameIndex(clip,time):0,frame=displayedClip?.frames[index];
  // Hand filling is never applied here: the evidence panel and avatar keep the original hand states.
  const display=useMemo(()=>clip&&!technical?runDisplayPipeline({clip,temporal:temporalView==='enhanced'?temporal??undefined:undefined},steady?[stabilizeTorso()]:[]):null,[clip,technical,temporal,temporalView,steady]);
  const focus=useMemo(()=>display?handFocus([display]):null,[display]);
  const pose=useMemo<DisplayPose|null>(()=>technical?frame?.pose??null:display?sampleDisplay(display,time):null,[display,time,technical,frame]);
  const suspects=useMemo(()=>displayedClip?.frames.flatMap((f,i)=>f.warnings.length?[i]:[])??[],[displayedClip]);
  const trackCounts=useMemo(()=>displayedClip?SIDES.map(side=>displayedClip.frames.filter(f=>f.pose.quality[`${side}State`]==='tracked').length):[0,0],[displayedClip]);
  useEffect(()=>setRange(NO_LOOP),[clip?.frames]);
  useEffect(()=>()=>{abort.current?.abort();},[]);
  useEffect(()=>{if(!active){video.current?.pause();setPlaying(false);abort.current?.abort();temporalAbort.current?.abort();setTemporalProgress(null);}},[active]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  useEffect(()=>{if(video.current)video.current.playbackRate=speed;},[speed,url]);
  useEffect(()=>{let request=0,last=performance.now();const tick=(now:number)=>{
    if(playing){
      const current=video.current?Math.max(0,playbackTime(video.current,0)-offset):Math.min(length,clock.current+(now-last)/1000*speed);
      const looped=loopTime(current,range);
      if(looped.wrapped)seek(looped.time);
      else {clock.current=current;setTime(current);if(current>=length)setPlaying(false);}
    }
    last=now;request=requestAnimationFrame(tick);
  };request=requestAnimationFrame(tick);return()=>cancelAnimationFrame(request);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,speed,length,url,offset,range]);
  useEffect(()=>{setEdit(clip?.edits.find(e=>e.frame===index&&e.side===correctionSide)?.degrees??[0,0,0]);},[index,correctionSide,clip]);
  const seek=(value:number)=>{const t=Math.max(0,Math.min(value,length));clock.current=t;setTime(t);if(video.current)video.current.currentTime=t+offset;};
  const pause=()=>{if(video.current){video.current.pause();clock.current=Math.max(0,video.current.currentTime-offset);setTime(clock.current);}setPlaying(false);};
  async function toggle(){if(playing){pause();return;}const start=loopTime(time,range);if(start.wrapped)seek(start.time);else if(time>=length)seek(0);try{if(video.current)await video.current.play();setPlaying(true);}catch(e){setError(`재생 실패: ${koMessage(e instanceof Error?e.message:String(e))}`);}}
  function selectVideo(selected:File|undefined){
    if(!selected)return;pause();setError('');
    if(!/\.(mp4|webm)$/i.test(selected.name)){setError('MP4 또는 WebM 영상을 선택해 주세요.');return;}
    if(selected.size>250*1024*1024){setError('250MB 미만의 영상을 선택해 주세요.');return;}
    const matches=clip&&selected.name===clip.source.name&&selected.size===clip.source.size;
    if(!matches)setClip(null);
    else setMirrored(clip.source.mirrored);
    setFile(selected);setUrl(URL.createObjectURL(selected));setTime(0);clock.current=0;setDuration(0);
  }
  async function reconstruct(){
    if(!file)return;pause();setError('');setClip(null);seek(0);
    const controller=new AbortController();abort.current=controller;setProgress({phase:'영상을 여는 중',done:0,total:0});
    try {const result=await extractMotion(file,{pipeline:handRegions?EXPERIMENTAL_PIPELINE:PIPELINE_VERSION,mirrored,sampleHz,signal:controller.signal,progress:setProgress});setClip(result);seek(0);}
    catch(e){setError(controller.signal.aborted?'분석을 취소했습니다. 불완전한 동작은 저장하지 않았습니다.':`동작 복원 실패: ${koMessage(e instanceof Error?e.message:String(e))}`);}
    finally{setProgress(null);abort.current=null;}
  }
  async function readJSON(event:ChangeEvent<HTMLInputElement>){
    const input=event.target.files?.[0];event.target.value='';if(!input)return;pause();setError('');
    try{if(input.size>100*1024*1024)throw new Error('파일 크기는 100MB를 초과할 수 없습니다.');const motion=importMotion(await input.text());
      if(!file||file.name!==motion.source.name||file.size!==motion.source.size){setFile(null);setUrl('');}
      setClip(motion);setMirrored(motion.source.mirrored);setDuration(motion.source.duration);setTime(0);clock.current=0;if(video.current)video.current.currentTime=motion.source.timeOffset??0;
    }catch(e){setError(`불러오기 실패: ${koMessage(e instanceof Error?e.message:String(e))}`);}
  }
  function saveEdit(){if(!clip)return;pause();setClip({...clip,edits:[...clip.edits.filter(e=>e.frame!==index||e.side!==correctionSide),{frame:index,side:correctionSide,degrees:edit}]});}
  const progressValue=progress?.total?Math.round(progress.done/progress.total*100):0;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="./" aria-label="SignLingo 동작 복원"><span className="brand-mark"><Hand size={21}/></span>SignLingo<span className="brand-divider"/> <span className="brand-subtitle">동작 복원</span></a><div className="topbar-right"><span className="local-label"><span className="status-dot"/> 기기 내 처리</span><span className="version">시제품 / 0.2</span></div></header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">한국수어 · 3D 동작 복원</div><h1>수어 동작을 3D로 재현합니다.</h1><p>실제 수어 영상에서 추출한 움직임을 3D 아바타로 확인하세요.</p></div><div className="file-actions"><button className="button secondary" onClick={()=>jsonInput.current?.click()} disabled={busy}><ArrowUpFromLine size={16}/>동작 JSON 불러오기</button><button className="button secondary" disabled={!clip||busy} onClick={()=>clip&&downloadMotion(clip)}><ArrowDownToLine size={16}/>JSON 내보내기</button></div></div>
      <input ref={upload} type="file" accept="video/mp4,video/webm,.mp4,.webm" hidden onChange={e=>{selectVideo(e.target.files?.[0]);e.target.value='';}}/>
      <input ref={jsonInput} type="file" accept="application/json,.json" hidden onChange={readJSON}/>
      <section className="workflow-bar" aria-label="복원 진행 단계"><div className="step active"><span>01</span>원본 영상</div><ChevronRight size={14}/><div className={`step ${busy||clip?'active':''}`}><span>02</span>동작 추출</div><ChevronRight size={14}/><div className={`step ${clip?'active':''}`}><span>03</span>복원 결과 확인</div><div className="workflow-note"><Info size={14}/> 추정된 3D 동작 · 수어 전문가 검증 필요</div></section>
      {error&&<div className="error-message" role="alert"><Info size={18}/><span>{error}</span><button aria-label="오류 메시지 닫기" onClick={()=>setError('')}><X size={16}/></button></div>}
      <div className="viewer-grid">
        <section className="viewer-panel"><div className="panel-heading"><div><span className="panel-number">01</span><h2>원본 영상</h2></div><span className="tag">원본</span></div>
          <div className={`video-stage ${url?'has-video':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)selectVideo(e.dataTransfer.files[0]);}}>
            {url?<div className="video-fit" style={{aspectRatio:clip?`${clip.source.width}/${clip.source.height}`:undefined}}>
              <video ref={video} src={url} playsInline preload="auto" muted onLoadedMetadata={e=>{const el=e.currentTarget;if(!Number.isFinite(el.duration)||el.duration>120){setError('이 시제품은 120초 이하의 영상만 지원합니다.');setDuration(0);return;}setDuration(el.duration);el.playbackRate=speed;el.parentElement!.style.aspectRatio=`${el.videoWidth}/${el.videoHeight}`;if(clip&&Math.abs(el.duration-clip.source.duration-offset)>0.15){setError('첨부 영상의 길이가 불러온 동작 데이터와 다릅니다. 영상을 다시 분석해 주세요.');setClip(null);}}} onPlay={()=>setPlaying(true)} onPause={e=>{clock.current=Math.max(0,e.currentTarget.currentTime-offset);setTime(clock.current);setPlaying(false);}} onEnded={()=>{setPlaying(false);setTime(length);}} onSeeked={e=>{clock.current=Math.max(0,e.currentTarget.currentTime-offset);setTime(clock.current);}} onError={()=>setError('브라우저에서 영상을 해독할 수 없습니다. H.264 MP4 또는 VP8/VP9 WebM 영상을 사용해 주세요.')} />
              {overlay&&clip&&<Overlay frame={frame} width={clip.source.width} height={clip.source.height} mirrored={clip.source.mirrored}/>}
            </div>:<div className="upload-empty"><div className="upload-illustration"><FileVideo size={31}/><span className="mini-plus">+</span></div><h3>{clip?'원본 영상 연결':'수어 영상으로 시작하기'}</h3><p>{clip?`비교할 원본 영상 “${clip.source.name}”을(를) 선택하세요.`:'여기에 영상을 놓으면 움직임을 복원할 수 있습니다.'}</p><button className="button primary" onClick={()=>upload.current?.click()}><Upload size={16}/>{clip?'영상 연결':'영상 선택'}</button><span className="upload-hint">MP4 또는 WebM · 최대 120초 / 250MB</span></div>}
            {url&&<><div className="stage-label"><span className="status-dot"/>{file?.name}</div><button className="replace-video" disabled={busy} onClick={()=>upload.current?.click()}><Upload size={13}/> 변경</button></>}
            {busy&&<div className="processing-scrim"><LoaderCircle className="spin" size={28}/><strong>{koMessage(progress.phase)}</strong><p>{progress.total?`${progress.done} / ${progress.total}프레임 · ${progressValue}%`:'첫 실행에는 AI 모델 파일을 내려받습니다.'}</p><progress value={progress.total?progress.done:undefined} max={progress.total||1}/><button className="button secondary" onClick={()=>abort.current?.abort()}>분석 취소</button></div>}
          </div>
          <div className="panel-toolbar"><label className="check"><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/><ScanLine size={15}/> 관절 추적 표시</label><span>{file?`${(file.size/1024/1024).toFixed(1)} MB`:'영상은 이 기기에서만 처리됩니다.'}</span></div>
        </section>
        <section className="viewer-panel avatar-panel"><div className="panel-heading"><div><span className="panel-number">02</span><h2>3D 동작 복원</h2></div><span className={`tag ${clip?'live':''}`}>{clip?(clip.pipeline.detector.includes('synthetic')?'합성 테스트':'추출된 동작'):'아바타 미리보기'}</span></div>
          <div className="avatar-stage"><Avatar pose={pose} skeleton={skeleton||technical} markers={markers||technical} view={view} focus={focus} resetKey={cameraReset} inspection={technical?frame:undefined}/><div className="camera-presets" aria-label="카메라 시점">{VIEWS.map(([value,label])=><button key={value} className={view===value?'selected':''} aria-pressed={view===value} onClick={()=>setView(value)}>{label}</button>)}<button aria-label="카메라 시점 초기화" onClick={()=>{setView('front');setCameraReset(n=>n+1);}}><RotateCcw size={13}/></button></div><div className="avatar-state">{clip?<><span className="status-dot"/> 프레임 {index+1} / {clip.frames.length}</>:<><Box size={13}/> 기본 자세 · 동작을 불러오지 않았습니다</>}</div><div className="orbit-hint"><Focus size={14}/> 드래그로 회전 · 스크롤로 확대</div><div className="axis-key"><i className="left-key"/>L <i className="right-key"/>R <span>수어 동작자의 실제 좌우</span></div></div>
          <div className="panel-toolbar"><div className="toolbar-checks"><label className="check"><input type="checkbox" checked={skeleton} onChange={e=>setSkeleton(e.target.checked)}/>뼈대 표시</label><label className="check"><input type="checkbox" checked={markers} onChange={e=>setMarkers(e.target.checked)}/>관절 표시</label><label className="check" title="학습 화면처럼 몸통 흔들림을 줄여 표시합니다. 손목 위치와 손 모양은 그대로이며 저장 데이터는 바뀌지 않습니다. 기술 진단 모드에서는 원본만 표시합니다."><input type="checkbox" checked={steady&&!technical} disabled={technical} onChange={e=>setSteady(e.target.checked)}/>몸통 고정</label></div><span>고정 길이 관절형 아바타</span></div>
        </section>
      </div>
      {clip&&!technical&&<div className="technical-toggle" aria-label="시간 복원 비교">
        <label>복원 비교 <select aria-label="시간 복원 선택" value={temporalView} onChange={e=>{pause();setTemporalView(e.target.value);}}><option value="original">원본 복원</option><option value="enhanced" disabled={!temporal}>시간 복원</option></select></label>
        {temporalProgress?<span role="status">{temporalProgress.phase} · {temporalProgress.done}/{temporalProgress.total} <button className="text-button" onClick={()=>{temporalAbort.current?.abort();setTemporalProgress(null);setTemporalView('original');}}>시간 복원 취소</button></span>:<span aria-live="polite">{SIDES.map(side=>{const e=pose?.evidence?.[side];const state=e?.state??(frame?.pose.quality[`${side}State`]==='tracked'?'observed':frame?.pose.quality[`${side}State`]==='held'?'held':'unavailable');return <span key={side} title={e?`손목 위치: ${evidenceLabel[e.position]} · 방향: ${evidenceLabel[e.orientation]} · 손가락: ${evidenceLabel[e.fingers]}`:undefined}>{side==='left'?'왼손':'오른손'}: {evidenceLabel[state]}{e?.state==='interpolated'&&e.fingers==='unavailable'?' (손가락 사용 불가)':''}　</span>;})}</span>}
        {!temporal&&!temporalProgress&&<button className="text-button" onClick={()=>{setTemporalView('enhanced');setTemporalRequest(n=>n+1);}}>시간 복원 실행</button>}
        <span>시간 보간은 추정된 표시이며 연습 점수의 관측 근거가 아닙니다.</span>
      </div>}
      <section className="transport" aria-label="영상과 동작 동기화 재생"><button className="play-button" aria-label={playing?'일시정지':'재생'} onClick={toggle} disabled={!length||busy}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><span className="time-readout">{timeLabel(time)} <span>/ {timeLabel(length)}</span></span><div className="timeline-container">{(()=>{const section=activeRange(range);return section&&length?<span className="timeline-loop" aria-hidden="true" style={{left:`${section.start/length*100}%`,width:`${(section.end-section.start)/length*100}%`}}/>:null;})()}<input aria-label="재생 위치" type="range" min={0} max={length||1} step={0.001} value={time} disabled={!length||busy} onChange={e=>seek(Number(e.target.value))}/><div className="timeline-flags">{suspects.filter((_,i)=>i%Math.max(1,Math.ceil(suspects.length/250))===0).map(i=><i key={i} style={{left:`${clip!.frames[i].timestamp/(length*1000)*100}%`}}/>)}</div></div><div className="speed-controls" aria-label="재생 속도">{[0.25,0.5,1].map(s=><button key={s} className={speed===s?'selected':''} aria-pressed={speed===s} onClick={()=>setSpeed(s)}>{s}×</button>)}</div><div className="speed-controls loop-controls" role="group" aria-label="구간 반복"><button className={range.a!==null?'selected':''} aria-pressed={range.a!==null} aria-label="구간 시작(A) 지정" disabled={!length||busy} onClick={()=>setRange({...range,a:time})}>A</button><button className={range.b!==null?'selected':''} aria-pressed={range.b!==null} aria-label="구간 끝(B) 지정" disabled={!length||busy||range.a===null} onClick={()=>setRange({...range,b:time})}>B</button>{(range.a!==null||range.b!==null)&&<button aria-label="구간 반복 해제" onClick={()=>setRange(NO_LOOP)}><X size={13}/></button>}</div><span className="sync-label"><span className={`status-dot ${clip?'':'inactive'}`}/>{clip?(url?'영상과 동기화됨':'동작만 재생 중'):'동작 대기 중'}</span></section>
      <div className="bottom-grid"><section className="settings-card"><div className="section-title"><Activity size={17}/><h2>동작 복원</h2><span className="small-tag">기기 내 처리</span></div><div className="settings-row"><div><label htmlFor="sampleHz">프레임 추출 빈도</label><p>30Hz는 짧은 손가락 움직임을 더 자세히 기록합니다.</p></div><select id="sampleHz" disabled={busy} value={sampleHz} onChange={e=>setSampleHz(Number(e.target.value))}><option value={15}>15프레임/초</option><option value={30}>30프레임/초</option></select></div><div className="settings-row"><div><label htmlFor="mirrored">원본 영상 좌우 반전</label><p>저장된 영상 자체가 좌우 반전된 경우 켜세요.</p></div><input id="mirrored" type="checkbox" disabled={busy} checked={mirrored} onChange={e=>setMirrored(e.target.checked)}/></div><div className="settings-row"><div><label htmlFor="handRegions">실험: 손 영역 재검출</label><p>파이프라인 0.3.0. 손 주변을 잘라 다시 찾습니다. 처리 시간이 2배 이상 늘고, 실제 영상 평가에서 누락을 줄이지 못했습니다.</p></div><input id="handRegions" type="checkbox" disabled={busy} checked={handRegions} onChange={e=>setHandRegions(e.target.checked)}/></div><button className="button primary process-button" onClick={reconstruct} disabled={!file||!duration||busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ScanLine size={17}/>} {busy?'프레임 분석 중…':clip?'영상 다시 분석':'동작 추출 및 복원'}<ChevronRight size={17}/></button><p className="settings-footnote">한 명의 수어 동작자와 어깨·양손이 보이는 영상을 사용하세요. 모델 파일은 외부 저장소에서 내려받으며, 계정이나 별도 분석 서버는 필요하지 않습니다.</p></section>
      <section className="diagnostics-card"><div className="section-title"><ScanLine size={17}/><h2>추적 진단</h2><span className={`diagnostic-status ${clip?'has-data':''}`}>{clip?'현재 프레임':'데이터 없음'}</span></div><div className="quality-grid">{[['몸통',frame?.pose.quality.body],['왼손',frame?.pose.quality.left],['오른손',frame?.pose.quality.right]].map(([label,value])=><div className="quality-cell" key={String(label)}><span>{label}</span><strong>{typeof value==='number'?value.toFixed(2):'—'}<small>{label==='몸통'?'가시성':'추정 신뢰도'}</small></strong><div className="quality-meter"><i style={{width:`${typeof value==='number'?value*100:0}%`}}/></div></div>)}</div><div className="diagnostic-details">{frame?<><div className="diagnostic-summary"><span>왼손: {koState(frame.pose.quality.leftState)} · 오른손: {koState(frame.pose.quality.rightState)}</span><span>{frame.corrections.length}건의 보정</span></div>{frame.warnings.length?<ul className="warning-list">{frame.warnings.map((w,i)=><li key={i}>{koMessage(w)}</li>)}</ul>:<p className="no-warnings"><Check size={14}/> 현재 프레임에서 발견된 주의 사항이 없습니다. 이는 정확성을 보장하지 않습니다.</p>}<div className="diagnostic-summary"><span>손 추적: 왼손 {trackCounts[0]} · 오른손 {trackCounts[1]} / 전체 {clip!.frames.length}프레임</span><button className="text-button" disabled={!suspects.length} onClick={()=>{pause();const next=suspects.find(i=>i>index)??suspects[0];seek(clip!.frames[next].timestamp/1000);}}>다음 주의 프레임 →</button></div></>:<div className="diagnostic-empty"><Info size={18}/><div><strong>아직 분석 결과가 없습니다.</strong><p>영상을 올리면 인식 누락, 양손 구분, 깊이 추정 및 관절 제약 문제를 확인할 수 있습니다.</p></div></div>}</div><p className="confidence-note">추정 신뢰도는 팔 가시성, 양손 분류 점수, 손바닥 형태의 안정성을 반영합니다. 실제 3D 정확도나 개별 손가락의 정확도를 뜻하지 않습니다.</p></section></div>
      {clip&&<div className="technical-toggle"><label className="check"><input type="checkbox" checked={technical} onChange={e=>{pause();setTechnical(e.target.checked);setPipelineView('stored');}}/>기술 진단 모드</label><span>복원 방식별 결과, 분석 프레임 및 기하학적 차이를 비교합니다.</span></div>}
      {technical&&comparisons&&<DiagnosticsLab clips={comparisons} view={pipelineView} onView={value=>{pause();setPipelineView(value);}} index={index} onSeek={t=>{pause();seek(t);}} onAdopt={()=>{pause();setClip(comparisons[pipelineView]);setPipelineView('stored');}}/>}
      {technical&&<p className="confidence-note">JSON 내보내기는 저장된 복원 결과와 수정 사항을 포함합니다. 다른 복원 결과를 사용하려면 선택한 복원 방식을 적용하세요. 기술 진단을 종료하면 손목을 직접 보정할 수 있습니다.</p>}
      {clip&&!technical&&<details className="manual-corrections"><summary>손목 직접 보정 <span>선택 사항 · 현재 프레임만 · JSON에 저장</span></summary><div className="correction-controls"><select aria-label="보정할 손" value={correctionSide} onChange={e=>setCorrectionSide(e.target.value as Side)}><option value="left">왼쪽 손목</option><option value="right">오른쪽 손목</option></select>{['굽힘','비틀림','편위'].map((label,i)=><label key={label}>{label} {edit[i]}°<input aria-label={`${label} correction`} type="range" min={-45} max={45} value={edit[i]} onChange={e=>{const n=[...edit] as Vec3;n[i]=Number(e.target.value);setEdit(n);}}/></label>)}<button className="button secondary" onClick={saveEdit}>현재 프레임 보정 저장</button><button className="text-button" onClick={()=>{setClip({...clip,edits:clip.edits.filter(e=>e.frame!==index||e.side!==correctionSide)});}}>프레임 보정 초기화</button></div><p>보정은 ±45° 범위이며 주변 프레임 사이에 보간됩니다. 이전 0.1 버전의 손목 제한도 유지됩니다. 저장된 보정: {clip.edits.length}건. 다시 분석하면 보정이 초기화됩니다.</p></details>}
      <footer><span><span className="footer-dot"/> 기술적인 동작 복원 결과이며 수어의 정답 판정이 아닙니다.</span><span>단일 영상의 깊이 추정에는 한계가 있으며 표정 문법은 복원되지 않습니다.</span><a href="https://github.com/KINGJNU-sakayume/SignLingo" target="_blank" rel="noreferrer">소스 코드 및 기술 보고서 ↗</a></footer>
    </main>
  </div>;
}
