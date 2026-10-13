import { useEffect, useState } from 'react';
import type { MotionClip } from '../motion/types';
import { assetUrl } from '../content/assets';
import { isPublished, parseCatalog } from '../content/validation';
import type { Catalog, Expression } from '../content/schema';
import { progressKey, type ProgressRecord } from './catalog';
import { LessonDetail } from './LessonDetail';
import { FingerspellingLesson } from './FingerspellingLesson';
import './lessons.css';

type Props = { progress: ProgressRecord; selected: string | null; onSelect: (id: string | null) => void;
  onViewed: (entry: Expression) => void; onPractice: (entry: Expression, clip: MotionClip) => void };

export function LessonHub({ progress, selected, onSelect, onViewed, onPractice }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [showFingerspelling,setShowFingerspelling]=useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    fetch(assetUrl('content/manifest.json'), { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const parsed = parseCatalog(await response.json());
      if (parsed.expressions.some(entry => !isPublished(entry))) throw new Error();
      if (!controller.signal.aborted) setCatalog(parsed);
    }).catch(() => { if (!controller.signal.aborted) setError('학습 목록을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.'); });
    return () => controller.abort();
  }, [retry]);
  const entry = catalog?.expressions.find(item => item.id === selected);
  const studied = catalog?.expressions.filter(item => progress[progressKey(item)]?.viewed || progress[progressKey(item)]?.attempts) ?? [];
  const recent = [...studied].filter(item => progress[progressKey(item)]?.lastAttempt).sort((a, b) =>
    (progress[progressKey(b)].lastAttempt ?? '').localeCompare(progress[progressKey(a)].lastAttempt ?? '')).slice(0, 5);
  return <main className="lesson-hub" lang="ko">
    <p className="eyebrow">SIGNLINGO / 한국수어 학습</p>
    <h1>수어를 보고, 따라 하고, 복습하세요.</h1>
    <p className="lesson-intro">한국수어는 고유한 문법을 가진 언어입니다. 시범을 관찰하고 움직임을 반복해서 익혀 보세요.</p>
    <div className="lesson-actions"><button type="button" className="button primary" aria-expanded={showFingerspelling} aria-controls="open-fingerspelling-lesson" onClick={()=>setShowFingerspelling(!showFingerspelling)}>{showFingerspelling?'지문자 학습 닫기':'공개 자료로 지문자 학습 시작 · 32개'}</button></div>
    {showFingerspelling?<div id="open-fingerspelling-lesson"><FingerspellingLesson/></div>:
    error ? <div role="alert" className="lesson-error">{error} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div> : !catalog ? <p role="status">학습 목록을 불러오는 중입니다…</p> : <>
      <div className="lesson-actions"><button className="button secondary" aria-pressed={!reviewOnly} onClick={() => { setReviewOnly(false); onSelect(null); }}>전체 학습 과정</button><button className="button secondary" aria-pressed={reviewOnly} onClick={() => { setReviewOnly(true); onSelect(null); }}>복습하기 · {studied.length}개</button></div>
      {entry ? <LessonDetail key={entry.id} entry={entry} progress={progress} onBack={() => onSelect(null)} onViewed={() => onViewed(entry)} onPractice={clip => onPractice(entry, clip)} /> : <>
        <section className="lesson-summary" aria-label="내 학습 기록"><p>학습 가능한 표현 <strong>{catalog.expressions.length}개</strong> · 관찰하거나 연습한 표현 <strong>{studied.length}개</strong></p><p className="lesson-note">기록은 이 브라우저에 저장됩니다. 학습 단계는 수어 정답률이 아닙니다.</p></section>
        {reviewOnly ? <section className="lesson-workspace"><h2>다시 살펴볼 표현</h2>{studied.length ? studied.map(item => <ExpressionButton key={item.id} entry={item} onSelect={onSelect} />) : <p className="lesson-empty">시범을 관찰하거나 연습한 표현이 여기에 나타납니다.</p>}</section> : <section aria-label="초급 학습 과정" className="lesson-path">
          {catalog.lessons.slice().sort((a, b) => a.order - b.order).map((lesson, i) => {
            const available = catalog.expressions.filter(item => item.lessonId === lesson.id).sort((a, b) => a.order - b.order);
            return <article className="lesson-workspace" key={lesson.id}><span className="lesson-meta">{String(i + 1).padStart(2, '0')} · {lesson.category}</span><h2>{lesson.title}</h2><p className="lesson-lead">{lesson.description}</p>
              {available.length ? available.map(item => <ExpressionButton key={item.id} entry={item} onSelect={onSelect} />) : <><button className="lesson-course" disabled>준비 중 · 아직 시작할 수 없습니다</button><p className="lesson-note">이용 허락과 한국수어·3D 동작 검수를 마친 표현부터 공개합니다.</p></>}
            </article>;
          })}
        </section>}
        {!catalog.expressions.length && <p className="lesson-empty">현재 공개된 3D 레슨이 없습니다. 원본 영상과 전문가 검수를 준비하고 있습니다. <a href="https://sldict.korean.go.kr/" target="_blank" rel="noreferrer">국립국어원 한국수어사전 방문 ↗</a></p>}
        <section className="lesson-workspace"><h2>최근 연습한 표현</h2>{recent.length ? recent.map(item => <ExpressionButton key={item.id} entry={item} onSelect={onSelect} />) : <p className="lesson-note">아직 연습 기록이 없습니다.</p>}</section>
      </>}
    </>}
  </main>;
}
function ExpressionButton({ entry, onSelect }: { entry: Expression; onSelect: (id: string) => void }) {
  return <button className="lesson-course" onClick={() => onSelect(entry.id)}><strong>{entry.displayName}</strong><small>시범 보기 · 직접 연습하기 →</small></button>;
}
