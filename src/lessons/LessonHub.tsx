import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { samplePose } from '../motion/player';
import { importMotion } from '../motion/serialization';
import type { MotionClip } from '../motion/types';
import { LESSONS, type LessonProgress } from './catalog';
import './lessons.css';

type Props={
  reference:MotionClip|null;
  progress:LessonProgress;
  onReference:(clip:MotionClip)=>void;
  onViewed:()=>void;
  onPractice:()=>void;
};
export function LessonHub({reference,progress,onReference,onViewed,onPractice}:Props){
  const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[error,setError]=useState('');
  const [videoFile,setVideoFile]=useState<File|null>(null);
  const video=useRef<HTMLVideoElement>(null);
  const url=useMemo(()=>videoFile?URL.createObjectURL(videoFile):'', [videoFile]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  useEffect(()=>{setPlaying(false);setTime(0);setVideoFile(null);},[reference]);
  const duration=(reference?.frames.at(-1)?.timestamp??0)/1000;
  const pose=useMemo(()=>reference?samplePose(reference,time):null,[reference,time]);
  const completed=(progress.viewed?1:0)+(progress.attempts>0?1:0);
  const seek=(value:number)=>{
    const target=Math.max(0,Math.min(duration,value));
    setTime(target);
    if(video.current&&reference&&video.current.readyState>=1)video.current.currentTime=target+(reference.source.timeOffset??0);
  };
  useEffect(()=>{
    if(!playing||!reference)return;
    const started=performance.now(),initial=time;
    const handle=window.setInterval(()=>{
      const sourceTime=video.current&&video.current.readyState>=1
        ?video.current.currentTime-(reference.source.timeOffset??0)
        :initial+(performance.now()-started)/1000;
      const next=Math.max(0,Math.min(duration,sourceTime));setTime(next);
      if(next>=duration){setPlaying(false);video.current?.pause();}
    },50);
    return()=>window.clearInterval(handle);
  },[playing,reference,duration]);
  const toggle=async()=>{
    if(!reference)return;
    if(playing){video.current?.pause();setPlaying(false);return;}
    if(time>=duration)seek(0);
    try{if(url&&video.current)await video.current.play();setPlaying(true);}
    catch{setError('원본 영상을 재생할 수 없습니다. 원본 영상 연결을 해제하고 3D 동작을 확인해 주세요.');}
  };
  async function loadMotion(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{
      if(file.size>100*1024*1024)throw new Error('100MB 이하의 동작 JSON을 선택하세요.');
      const clip=importMotion(await file.text());
      if(clip.frames.length<3)throw new Error('학습용 동작에는 최소 3개 프레임이 필요합니다.');
      setError('');onReference(clip);
    }catch(e){setError('동작 JSON을 불러오지 못했습니다: '+(e instanceof Error?e.message:String(e)));}
  }
  function loadVideo(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];e.target.value='';if(!file||!reference)return;
    if(file.name!==reference.source.name||file.size!==reference.source.size){
      setError('원본 영상의 이름과 파일 크기가 연결된 동작 JSON과 다릅니다.');
      return;
    }
    setError('');setVideoFile(file);setPlaying(false);setTime(0);
  }
  return <main className="lesson-hub" lang="ko">
    <p className="eyebrow">SIGNLINGO / 한국수어 학습</p>
    <h1>수어를 보고, 따라 하고, 복습하세요.</h1>
    <p className="lesson-intro">학습 과정의 첫 번째 버전입니다. 검증된 동작 자료를 연결해 시범부터 연습까지 진행할 수 있습니다.</p>
    <div className="lesson-layout">
      <aside className="lesson-courses" aria-label="학습 과정">
        <h2>학습 과정</h2>
        {LESSONS.map((item,i)=><button key={item.id} className={'lesson-course '+(i===0?'active':'')} disabled={item.status==='planned'} aria-current={i===0?'step':undefined}>
          <span className="lesson-meta">{item.unit} · {String(i+1).padStart(2,'0')}</span>
          <strong>{item.title}</strong><small>{item.status==='planned'?'준비 중':reference?'연습 자료 연결됨':'검증된 자료 연결 필요'}</small>
        </button>)}
        <div className="lesson-progressbar" role="progressbar" aria-label="첫 레슨 진행도" aria-valuemin={0} aria-valuemax={2} aria-valuenow={completed}><span style={{width:(completed/2*100)+'%'}}/></div>
        <p className="lesson-note">첫 레슨 학습 흐름 {completed}/2단계 · 수어 정답률이 아닙니다.</p>
      </aside>
      <section className="lesson-workspace" aria-labelledby="lesson-title">
        <span className="lesson-meta">첫걸음 · 레슨 01</span>
        <h2 id="lesson-title">나의 첫 수어 표현</h2>
        <p className="lesson-lead">관찰 → 따라 하기 → 결과 검토 순으로 진행합니다. 현재 저장소에는 전문가가 검증한 한국수어 정답 영상이 포함되지 않았습니다.</p>
        <div className="lesson-steps"><span className={reference?'done':''}>1. 기준 동작 연결</span><span className={progress.viewed?'done':''}>2. 시범 관찰</span><span className={progress.attempts>0?'done':''}>3. 직접 연습</span></div>
        <label className="lesson-file">기준 동작 JSON 연결
          <input type="file" accept="application/json,.json" aria-label="레슨 기준 동작 JSON" onChange={e=>void loadMotion(e)}/>
          <span className="lesson-note">동작 복원 화면에서 추출한 MotionClip JSON을 선택하세요. 파일은 서버에 업로드되지 않으며 현재 페이지에만 보관됩니다.</span>
        </label>
        {error&&<p className="lesson-error" role="alert">{error}</p>}
        {reference?<><p className="lesson-progress-note">연결된 자료: {reference.source.name} · {reference.frames.length}프레임. 이 파일을 불러왔다고 언어적으로 올바른 한국수어가 인증되는 것은 아닙니다.</p>
          <label className="lesson-file">일치하는 원본 수어 영상 연결 (선택)
            <input type="file" accept="video/*" aria-label="레슨 원본 영상" onChange={loadVideo}/>
          </label>
          <div className="lesson-reference">
            <section><h3>3D 동작 시범</h3><div className="practice-avatar"><Avatar pose={pose} skeleton={false} markers={false} preset="front"/></div></section>
            <section><h3>원본 수어 영상</h3>{url?<video ref={video} src={url} muted playsInline preload="metadata" onEnded={()=>setPlaying(false)} onError={()=>setError('원본 영상을 읽을 수 없습니다. 다른 형식의 영상을 선택해 주세요.')}/>:<div className="lesson-empty">원본 영상을 연결하면 3D 시범과 나란히 비교할 수 있습니다. 연결하지 않아도 3D 동작은 확인할 수 있습니다.</div>}</section>
          </div>
          <div className="lesson-slider"><button className="button secondary" type="button" onClick={()=>void toggle()}>{playing?'일시정지':'시범 재생'}</button><input type="range" min={0} max={duration||1} step=".01" value={time} aria-label="시범 재생 위치" onChange={e=>seek(Number(e.target.value))}/><span>{time.toFixed(1)} / {duration.toFixed(1)}초</span></div>
          <div className="lesson-actions"><button className="button secondary" type="button" onClick={onViewed}>{progress.viewed?'시범 관찰 기록됨':'시범 확인 완료'}</button><button className="button primary" type="button" onClick={onPractice}>카메라로 따라 하기 →</button></div>
          <p className="lesson-progress-note">{progress.attempts>0? `이 레슨에서 ${progress.attempts}회 연습 결과를 검토했습니다. ${progress.lastEvidence==='limited'?'추적 정보가 부족한 부분도 있었습니다.':'관찰 가능한 동작 차이를 확인했습니다.'}`:'아직 이 레슨에 연결된 연습 기록이 없습니다.'}</p>
        </>:<div className="lesson-empty">학습 자료를 연결하면 이곳에 3D 시범과 반복 재생, 웹캠 연습 버튼이 표시됩니다. 허위 수어 동작이나 임의의 정답 애니메이션은 제공하지 않습니다.</div>}
        <p className="lesson-footer-note">학습 단계 완료는 시범 관찰과 연습 수행 기록입니다. 수어를 정확하게 표현했다는 판정이 아닙니다. 학습 진도는 이 브라우저에만 저장되고, 원본 영상과 동작 JSON은 저장되지 않습니다.</p>
      </section>
    </div>
  </main>;
}
