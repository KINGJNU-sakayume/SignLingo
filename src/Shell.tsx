import { useEffect,useState } from 'react';
import MotionLab from './App';
import { PracticeMode } from './practice/PracticeMode';
import { LessonHub } from './lessons/LessonHub';
import { LocalLessonLab } from './lessons/LocalLessonLab';
import { readProgress, saveProgress, progressKey, recordPractice, type LessonProgress } from './lessons/catalog';
import type { Expression } from './content/schema';
import type { MotionClip } from './motion/types';

const LESSON_ID='first-expression';
const EMPTY:LessonProgress={viewed:false,attempts:0};
export default function Shell(){
  const [mode,setMode]=useState<'learn'|'lab'|'practice'|'local'>('learn');
  const [reference,setReference]=useState<MotionClip|null>(null);
  const [fromLesson,setFromLesson]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [guidedEntry,setGuidedEntry]=useState<Expression|null>(null);
  const [guidedReference,setGuidedReference]=useState<MotionClip|null>(null);
  const [progress,setProgress]=useState(readProgress);
  useEffect(()=>saveProgress(progress),[progress]);
  const current=progress[LESSON_ID]??EMPTY;
  const setCurrent=(update:(p:LessonProgress)=>LessonProgress)=>setProgress(old=>({...old,[LESSON_ID]:update(old[LESSON_ID]??EMPTY)}));
  const connect=(clip:MotionClip)=>{
    setReference(clip);
    // Content identity changes: never carry completion credit to an unverified replacement.
    setCurrent(()=>({...EMPTY}));
  };
  const practiceLesson=()=>{if(!reference)return;setGuidedEntry(null);setGuidedReference(reference);setFromLesson(true);setMode('practice');};
  const practiceFree=()=>{setFromLesson(false);setMode('practice');};
  const noteResult=(evidence:'sufficient'|'limited',feedback:string[]=[])=>{
    const key=guidedEntry?progressKey(guidedEntry):LESSON_ID;
    setProgress(old=>({...old,[key]:recordPractice(old[key]??EMPTY,evidence,feedback)}));
    setMode(guidedEntry?'learn':'local');
  };
  return <>
    <nav className="mode-nav" aria-label="작업 영역">
      <button aria-pressed={mode==='learn'} onClick={()=>setMode('learn')}>학습하기</button>
      <button aria-pressed={mode==='lab'} onClick={()=>setMode('lab')}>동작 복원</button>
      <button aria-pressed={mode==='practice'} onClick={practiceFree}>수어 연습</button>
    </nav>
    {mode==='learn'&&<LessonHub progress={progress} selected={selected} onSelect={setSelected}
      onViewed={entry=>setProgress(old=>({...old,[progressKey(entry)]:{...(old[progressKey(entry)]??EMPTY),viewed:true}}))}
      onPractice={(entry,clip)=>{setGuidedEntry(entry);setGuidedReference(clip);setFromLesson(true);setMode('practice');}}/>}
    {mode==='local'&&<><p className="operator-note">운영자용 로컬 점검 · 선택한 파일은 공개 레슨에 등록되지 않습니다.</p><LocalLessonLab reference={reference} progress={current} onReference={connect}
      onViewed={()=>setCurrent(p=>({...p,viewed:true}))} onPractice={practiceLesson}/></>}
    <div hidden={mode!=='lab'}><MotionLab active={mode==='lab'}/><section className="operator-note"><h2>학습 콘텐츠 준비</h2><p>영상별 이용 허락을 등록한 뒤 원본과 복원 결과를 비교하세요. 손목 보정과 기술 진단 후 별도의 한국수어 검수가 필요합니다.</p><button className="button secondary" onClick={()=>setMode('local')}>로컬 자료로 학습 흐름 점검</button></section></div>
    {mode==='practice'&&<PracticeMode key={fromLesson?'guided':'free'} initialReference={fromLesson?guidedReference:null}
      onResultReviewed={fromLesson?noteResult:undefined} onReturnToLesson={fromLesson?()=>setMode(guidedEntry?'learn':'local'):undefined}/>}
  </>;
}
