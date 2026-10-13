import { useEffect,useState } from 'react';
import MotionLab from './App';
import { PracticeMode } from './practice/PracticeMode';
import { LessonHub } from './lessons/LessonHub';
import { PROGRESS_KEY, readProgress, saveProgress, type LessonProgress } from './lessons/catalog';
import type { MotionClip } from './motion/types';

const LESSON_ID='first-expression';
const EMPTY:LessonProgress={viewed:false,attempts:0};
export default function Shell(){
  const [mode,setMode]=useState<'learn'|'lab'|'practice'>('lab');
  const [reference,setReference]=useState<MotionClip|null>(null);
  const [fromLesson,setFromLesson]=useState(false);
  const [progress,setProgress]=useState(readProgress);
  useEffect(()=>saveProgress(progress),[progress]);
  const current=progress[LESSON_ID]??EMPTY;
  const setCurrent=(update:(p:LessonProgress)=>LessonProgress)=>setProgress(old=>({...old,[LESSON_ID]:update(old[LESSON_ID]??EMPTY)}));
  const connect=(clip:MotionClip)=>{
    setReference(clip);
    // Content identity changes: never carry completion credit to an unverified replacement.
    setCurrent(()=>({...EMPTY}));
  };
  const practiceLesson=()=>{if(!reference)return;setFromLesson(true);setMode('practice');};
  const practiceFree=()=>{setFromLesson(false);setMode('practice');};
  const noteResult=(evidence:'sufficient'|'limited')=>{
    setCurrent(p=>({...p,attempts:p.attempts+1,lastAttempt:new Date().toISOString(),lastEvidence:evidence}));
    setMode('learn');
  };
  return <>
    <nav className="mode-nav" aria-label="작업 영역">
      <button aria-pressed={mode==='learn'} onClick={()=>setMode('learn')}>학습하기</button>
      <button aria-pressed={mode==='lab'} onClick={()=>setMode('lab')}>동작 복원</button>
      <button aria-pressed={mode==='practice'} onClick={practiceFree}>수어 연습</button>
    </nav>
    {mode==='learn'&&<LessonHub reference={reference} progress={current} onReference={connect}
      onViewed={()=>setCurrent(p=>({...p,viewed:true}))} onPractice={practiceLesson}/>}
    <div hidden={mode!=='lab'}><MotionLab active={mode==='lab'}/></div>
    {mode==='practice'&&<PracticeMode key={fromLesson?'guided':'free'} initialReference={fromLesson?reference:null}
      onResultReviewed={fromLesson?noteResult:undefined} onReturnToLesson={fromLesson?()=>setMode('learn'):undefined}/>}
  </>;
}
