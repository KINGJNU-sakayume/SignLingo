import { useState } from 'react';
import MotionLab from './App';
import { PracticeMode } from './practice/PracticeMode';
export default function Shell() {
  const [mode,setMode]=useState<'lab'|'practice'>('lab');
  return <><nav className="mode-nav" aria-label="Workspace"><button aria-pressed={mode==='lab'} onClick={()=>setMode('lab')}>Motion Lab</button><button aria-pressed={mode==='practice'} onClick={()=>setMode('practice')}>Practice Mode</button></nav><div hidden={mode!=='lab'}><MotionLab active={mode==='lab'}/></div>{mode==='practice'&&<PracticeMode/>}</>;
}
