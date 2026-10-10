import { useEffect,useMemo,useRef,useState, type ChangeEvent } from 'react';
import { Activity,ArrowDownToLine,ArrowUpFromLine,Box,Check,ChevronRight,FileVideo,Focus,Hand,Info,LoaderCircle,Pause,Play,RotateCcw,ScanLine,Upload,X } from 'lucide-react';
import { Avatar } from './components/Avatar';
import { Overlay } from './components/Overlay';
import { MediaPipeDetector } from './motion/detector';
import { processVideo,type Progress } from './motion/video';
import { downloadMotion,importMotion } from './motion/serialization';
import { frameIndex,playbackTime,samplePose } from './motion/player';
import { SIDES,type MotionClip,type Side,type Vec3 } from './motion/types';
const timeLabel=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
export default function App(){
  const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[clip,setClip]=useState<MotionClip|null>(null);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [overlay,setOverlay]=useState(true),[skeleton,setSkeleton]=useState(false),[markers,setMarkers]=useState(false),[preset,setPreset]=useState('front');
  const [mirrored,setMirrored]=useState(false),[sampleHz,setSampleHz]=useState(30),[progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState('');
  const [correctionSide,setCorrectionSide]=useState<Side>('left'),[edit,setEdit]=useState<Vec3>([0,0,0]);
  const video=useRef<HTMLVideoElement>(null),upload=useRef<HTMLInputElement>(null),jsonInput=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null);
  const clock=useRef(0);const busy=!!progress;
  const length=clip?.source.duration??duration;
  const index=clip?frameIndex(clip,time):0,frame=clip?.frames[index];
  const pose=useMemo(()=>clip?samplePose(clip,time):null,[clip,time]);
  const suspects=useMemo(()=>clip?.frames.flatMap((f,i)=>f.warnings.length?[i]:[])??[],[clip]);
  const trackCounts=useMemo(()=>clip?SIDES.map(side=>clip.frames.filter(f=>f.pose.quality[`${side}State`]==='tracked').length):[0,0],[clip]);
  useEffect(()=>()=>{abort.current?.abort();},[]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  useEffect(()=>{if(video.current)video.current.playbackRate=speed;},[speed,url]);
  useEffect(()=>{let request=0,last=performance.now();const tick=(now:number)=>{
    if(playing){
      const current=video.current?playbackTime(video.current,0):Math.min(length,clock.current+(now-last)/1000*speed);
      clock.current=current;setTime(current);if(current>=length)setPlaying(false);
    }
    last=now;request=requestAnimationFrame(tick);
  };request=requestAnimationFrame(tick);return()=>cancelAnimationFrame(request);},[playing,speed,length,url]);
  useEffect(()=>{setEdit(clip?.edits.find(e=>e.frame===index&&e.side===correctionSide)?.degrees??[0,0,0]);},[index,correctionSide,clip]);
  const seek=(value:number)=>{const t=Math.max(0,Math.min(value,length));clock.current=t;setTime(t);if(video.current)video.current.currentTime=t;};
  const pause=()=>{if(video.current){video.current.pause();clock.current=video.current.currentTime;setTime(video.current.currentTime);}setPlaying(false);};
  async function toggle(){if(playing){pause();return;}if(time>=length)seek(0);try{if(video.current)await video.current.play();setPlaying(true);}catch(e){setError(`Playback failed: ${e instanceof Error?e.message:e}`);}}
  function selectVideo(selected:File|undefined){
    if(!selected)return;pause();setError('');
    if(!/\.(mp4|webm)$/i.test(selected.name)){setError('Choose an MP4 or WebM video.');return;}
    if(selected.size>250*1024*1024){setError('Choose a video smaller than 250 MB.');return;}
    const matches=clip&&selected.name===clip.source.name&&selected.size===clip.source.size;
    if(!matches)setClip(null);
    else setMirrored(clip.source.mirrored);
    setFile(selected);setUrl(URL.createObjectURL(selected));setTime(0);clock.current=0;setDuration(0);
  }
  async function reconstruct(){
    if(!file)return;pause();setError('');setClip(null);seek(0);
    const controller=new AbortController();abort.current=controller;setProgress({phase:'Opening video',done:0,total:0});
    try {const result=await processVideo(file,new MediaPipeDetector(),{mirrored,sampleHz,signal:controller.signal,progress:setProgress});setClip(result);seek(0);}
    catch(e){setError(controller.signal.aborted?'Processing canceled. No incomplete animation was kept.':`Reconstruction failed: ${e instanceof Error?e.message:String(e)}`);}
    finally{setProgress(null);abort.current=null;}
  }
  async function readJSON(event:ChangeEvent<HTMLInputElement>){
    const input=event.target.files?.[0];event.target.value='';if(!input)return;pause();setError('');
    try{if(input.size>100*1024*1024)throw new Error('File exceeds 100 MB.');const motion=importMotion(await input.text());
      if(!file||file.name!==motion.source.name||file.size!==motion.source.size){setFile(null);setUrl('');}
      setClip(motion);setMirrored(motion.source.mirrored);setDuration(motion.source.duration);setTime(0);clock.current=0;if(video.current)video.current.currentTime=0;
    }catch(e){setError(`Import rejected: ${e instanceof Error?e.message:String(e)}`);}
  }
  function saveEdit(){if(!clip)return;pause();setClip({...clip,edits:[...clip.edits.filter(e=>e.frame!==index||e.side!==correctionSide),{frame:index,side:correctionSide,degrees:edit}]});}
  const progressValue=progress?.total?Math.round(progress.done/progress.total*100):0;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="./" aria-label="SignLingo Motion Lab"><span className="brand-mark"><Hand size={21}/></span>SignLingo<span className="brand-divider"/> <span className="brand-subtitle">Motion Lab</span></a><div className="topbar-right"><span className="local-label"><span className="status-dot"/> Browser processing</span><span className="version">PoC / 0.1</span></div></header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">KOREAN SIGN LANGUAGE · RECONSTRUCTION WORKSPACE</div><h1>From movement to motion.</h1><p>Inspect how a real video translates into an articulated 3D pose.</p></div><div className="file-actions"><button className="button secondary" onClick={()=>jsonInput.current?.click()} disabled={busy}><ArrowUpFromLine size={16}/>Import motion</button><button className="button secondary" disabled={!clip||busy} onClick={()=>clip&&downloadMotion(clip)}><ArrowDownToLine size={16}/>Export JSON</button></div></div>
      <input ref={upload} type="file" accept="video/mp4,video/webm,.mp4,.webm" hidden onChange={e=>{selectVideo(e.target.files?.[0]);e.target.value='';}}/>
      <input ref={jsonInput} type="file" accept="application/json,.json" hidden onChange={readJSON}/>
      <section className="workflow-bar" aria-label="Reconstruction steps"><div className="step active"><span>01</span>Source video</div><ChevronRight size={14}/><div className={`step ${busy||clip?'active':''}`}><span>02</span>Extract motion</div><ChevronRight size={14}/><div className={`step ${clip?'active':''}`}><span>03</span>Inspect reconstruction</div><div className="workflow-note"><Info size={14}/> Estimated 3D · signer validation required</div></section>
      {error&&<div className="error-message" role="alert"><Info size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      <div className="viewer-grid">
        <section className="viewer-panel"><div className="panel-heading"><div><span className="panel-number">01</span><h2>Original video</h2></div><span className="tag">SOURCE</span></div>
          <div className={`video-stage ${url?'has-video':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)selectVideo(e.dataTransfer.files[0]);}}>
            {url?<div className="video-fit" style={{aspectRatio:clip?`${clip.source.width}/${clip.source.height}`:undefined}}>
              <video ref={video} src={url} playsInline preload="auto" muted onLoadedMetadata={e=>{const el=e.currentTarget;if(!Number.isFinite(el.duration)||el.duration>120){setError('This prototype accepts clips up to 120 seconds.');setDuration(0);return;}setDuration(el.duration);el.playbackRate=speed;el.parentElement!.style.aspectRatio=`${el.videoWidth}/${el.videoHeight}`;if(clip&&Math.abs(el.duration-clip.source.duration)>0.15){setError('Attached video duration does not match the imported motion. Reprocess this video.');setClip(null);}}} onPlay={()=>setPlaying(true)} onPause={e=>{clock.current=e.currentTarget.currentTime;setTime(e.currentTarget.currentTime);setPlaying(false);}} onEnded={()=>{setPlaying(false);setTime(length);}} onSeeked={e=>{setTime(e.currentTarget.currentTime);clock.current=e.currentTarget.currentTime;}} onError={()=>setError('The browser cannot decode this video. Try H.264 MP4 or VP8/VP9 WebM.')} />
              {overlay&&clip&&<Overlay frame={frame} width={clip.source.width} height={clip.source.height} mirrored={clip.source.mirrored}/>}
            </div>:<div className="upload-empty"><div className="upload-illustration"><FileVideo size={31}/><span className="mini-plus">+</span></div><h3>{clip?'Attach the original video':'Start with a signing video'}</h3><p>{clip?`Select “${clip.source.name}” to compare.`:'Drop a video here to reconstruct the movement.'}</p><button className="button primary" onClick={()=>upload.current?.click()}><Upload size={16}/>{clip?'Attach video':'Choose video'}</button><span className="upload-hint">MP4 or WebM · up to 120 s / 250 MB</span></div>}
            {url&&<><div className="stage-label"><span className="status-dot"/>{file?.name}</div><button className="replace-video" disabled={busy} onClick={()=>upload.current?.click()}><Upload size={13}/> Replace</button></>}
            {busy&&<div className="processing-scrim"><LoaderCircle className="spin" size={28}/><strong>{progress.phase}</strong><p>{progress.total?`${progress.done} / ${progress.total} frames · ${progressValue}%`:'First load downloads public model assets.'}</p><progress value={progress.total?progress.done:undefined} max={progress.total||1}/><button className="button secondary" onClick={()=>abort.current?.abort()}>Cancel processing</button></div>}
          </div>
          <div className="panel-toolbar"><label className="check"><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/><ScanLine size={15}/> Landmark overlay</label><span>{file?`${(file.size/1024/1024).toFixed(1)} MB`:'Your video stays on this device'}</span></div>
        </section>
        <section className="viewer-panel avatar-panel"><div className="panel-heading"><div><span className="panel-number">02</span><h2>3D reconstruction</h2></div><span className={`tag ${clip?'live':''}`}>{clip?(clip.pipeline.detector.includes('synthetic')?'SYNTHETIC TEST':'EXTRACTED MOTION'):'RIG PREVIEW'}</span></div>
          <div className="avatar-stage"><Avatar pose={pose} skeleton={skeleton} markers={markers} preset={preset}/><div className="camera-presets" aria-label="Camera angle">{['front','side','rear'].map(p=><button key={p} className={preset===p?'selected':''} onClick={()=>setPreset(p)}>{p}</button>)}<button aria-label="Reset camera" onClick={()=>{setPreset('reset');requestAnimationFrame(()=>setPreset('front'));}}><RotateCcw size={13}/></button></div><div className="avatar-state">{clip?<><span className="status-dot"/> Frame {index+1} / {clip.frames.length}</>:<><Box size={13}/> Rest pose · no motion loaded</>}</div><div className="orbit-hint"><Focus size={14}/> Drag to orbit · scroll to zoom</div><div className="axis-key"><i className="left-key"/>L <i className="right-key"/>R <span>Signer’s anatomical sides</span></div></div>
          <div className="panel-toolbar"><div className="toolbar-checks"><label className="check"><input type="checkbox" checked={skeleton} onChange={e=>setSkeleton(e.target.checked)}/>Skeleton</label><label className="check"><input type="checkbox" checked={markers} onChange={e=>setMarkers(e.target.checked)}/>Joint markers</label></div><span>Fixed-length articulated rig</span></div>
        </section>
      </div>
      <section className="transport" aria-label="Synchronized playback"><button className="play-button" aria-label={playing?'Pause':'Play'} onClick={toggle} disabled={!length||busy}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><span className="time-readout">{timeLabel(time)} <span>/ {timeLabel(length)}</span></span><div className="timeline-container"><input aria-label="Seek timeline" type="range" min={0} max={length||1} step={0.001} value={time} disabled={!length||busy} onChange={e=>seek(Number(e.target.value))}/><div className="timeline-flags">{suspects.filter((_,i)=>i%Math.max(1,Math.ceil(suspects.length/250))===0).map(i=><i key={i} style={{left:`${clip!.frames[i].timestamp/(length*1000)*100}%`}}/>)}</div></div><div className="speed-controls" aria-label="Playback speed">{[0.25,0.5,1].map(s=><button key={s} className={speed===s?'selected':''} aria-pressed={speed===s} onClick={()=>setSpeed(s)}>{s}×</button>)}</div><span className="sync-label"><span className={`status-dot ${clip?'':'inactive'}`}/>{clip?(url?'Video clock linked':'Motion-only playback'):'Awaiting motion'}</span></section>
      <div className="bottom-grid"><section className="settings-card"><div className="section-title"><Activity size={17}/><h2>Reconstruction</h2><span className="small-tag">CLIENT-SIDE</span></div><div className="settings-row"><div><label htmlFor="sampleHz">Frame sampling</label><p>30 Hz preserves more brief finger movements.</p></div><select id="sampleHz" disabled={busy} value={sampleHz} onChange={e=>setSampleHz(Number(e.target.value))}><option value={15}>15 fps</option><option value={30}>30 fps</option></select></div><div className="settings-row"><div><label htmlFor="mirrored">Mirrored source</label><p>Enable if the saved video is horizontally flipped.</p></div><input id="mirrored" type="checkbox" disabled={busy} checked={mirrored} onChange={e=>setMirrored(e.target.checked)}/></div><button className="button primary process-button" onClick={reconstruct} disabled={!file||!duration||busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ScanLine size={17}/>} {busy?'Processing frames…':clip?'Reprocess video':'Extract & reconstruct'}<ChevronRight size={17}/></button><p className="settings-footnote">One signer, visible shoulders and hands. Models load from Google Storage and jsDelivr. No account or inference server.</p></section>
      <section className="diagnostics-card"><div className="section-title"><ScanLine size={17}/><h2>Tracking diagnostics</h2><span className={`diagnostic-status ${clip?'has-data':''}`}>{clip?'LIVE FRAME':'NO DATA'}</span></div><div className="quality-grid">{[['Torso',frame?.pose.quality.body],['Left hand',frame?.pose.quality.left],['Right hand',frame?.pose.quality.right]].map(([label,value])=><div className="quality-cell" key={String(label)}><span>{label}</span><strong>{typeof value==='number'?value.toFixed(2):'—'}<small>{label==='Torso'?'visibility':'confidence proxy'}</small></strong><div className="quality-meter"><i style={{width:`${typeof value==='number'?value*100:0}%`}}/></div></div>)}</div><div className="diagnostic-details">{frame?<><div className="diagnostic-summary"><span>L: {frame.pose.quality.leftState} · R: {frame.pose.quality.rightState}</span><span>{frame.corrections.length} corrections</span></div>{frame.warnings.length?<ul className="warning-list">{frame.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>:<p className="no-warnings"><Check size={14}/> No heuristic flags at this frame. This does not establish accuracy.</p>}<div className="diagnostic-summary"><span>Tracked hands: L {trackCounts[0]} · R {trackCounts[1]} of {clip!.frames.length} frames</span><button className="text-button" disabled={!suspects.length} onClick={()=>{pause();const next=suspects.find(i=>i>index)??suspects[0];seek(clip!.frames[next].timestamp/1000);}}>Next flagged frame →</button></div></>:<div className="diagnostic-empty"><Info size={18}/><div><strong>Nothing estimated yet.</strong><p>Upload a video to inspect missing detections, hand identity, depth warnings and joint constraints.</p></div></div>}</div><p className="confidence-note">Confidence proxy = minimum arm visibility / hand handedness score. It is not 3D accuracy or a per-finger confidence measurement.</p></section></div>
      {clip&&<details className="manual-corrections"><summary>Manual wrist correction <span>Optional · current frame only · included in JSON</span></summary><div className="correction-controls"><select aria-label="Correction hand" value={correctionSide} onChange={e=>setCorrectionSide(e.target.value as Side)}><option value="left">Left wrist</option><option value="right">Right wrist</option></select>{['Flexion','Twist','Deviation'].map((label,i)=><label key={label}>{label} {edit[i]}°<input aria-label={`${label} correction`} type="range" min={-45} max={45} value={edit[i]} onChange={e=>{const n=[...edit] as Vec3;n[i]=Number(e.target.value);setEdit(n);}}/></label>)}<button className="button secondary" onClick={saveEdit}>Save frame correction</button><button className="text-button" onClick={()=>{setClip({...clip,edits:clip.edits.filter(e=>e.frame!==index||e.side!==correctionSide)});}}>Reset frame</button></div><p>Offsets are bounded by wrist limits and interpolate to neighboring frames. {clip.edits.length} saved correction(s). Reprocessing clears edits.</p></details>}
      <footer><span><span className="footer-dot"/> Technical reconstruction, not linguistic validation.</span><span>Monocular depth is ambiguous. Facial grammar is not reconstructed.</span><a href="https://github.com/KINGJNU-sakayume/SignLingo" target="_blank" rel="noreferrer">Source & technical report ↗</a></footer>
    </main>
  </div>;
}
