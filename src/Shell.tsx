import { useState } from 'react';
import MotionLab from './App';
import { PracticeMode } from './practice/PracticeMode';
export default function Shell() {
  const [mode,setMode]=useState<'lab'|'practice'>('lab');
  return <><nav className="mode-nav" aria-label="작업 영역"><button aria-pressed={mode==='lab'} onClick={()=>setMode('lab')}>동작 복원</button><button aria-pressed={mode==='practice'} onClick={()=>setMode('practice')}>수어 연습</button></nav><div hidden={mode!=='lab'}><MotionLab active={mode==='lab'}/></div>{mode==='practice'&&<PracticeMode/>}</>;
}
