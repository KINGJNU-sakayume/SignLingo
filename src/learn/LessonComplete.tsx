import { useEffect, useRef, type CSSProperties } from 'react';
import { Trophy } from 'lucide-react';
import { ChunkyButton } from '../design/ChunkyButton';
import { Mascot } from '../design/Mascot';
import type { sessionSummary } from './session';

type Summary = ReturnType<typeof sessionSummary>;
const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function useFocus() {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  return button;
}
function Confetti() {
  return <div className="lc-confetti" aria-hidden="true">{CONFETTI.map(i => <span key={i} style={{ '--i': i } as CSSProperties} />)}</div>;
}

/** Recognition counts are shown as answers; camera practice is shown only as a count of attempts. */
export function LessonComplete({ kind, summary, onContinue }: { kind: 'lesson' | 'review'; summary: Summary; onContinue: () => void }) {
  const button = useFocus();
  const cards = [
    { tone: 'leaf', label: '보고 이해하기', value: summary.graded ? `${summary.firstTryCorrect}/${summary.graded}` : '시범 보기' },
    { tone: 'sky', label: '걸린 시간', value: formatDuration(summary.durationMs) },
    kind === 'lesson' ? { tone: 'sun', label: '새 표현', value: `${summary.newExpressions}개` } : { tone: 'sun', label: '복습한 표현', value: `${summary.reviewed}개` },
    ...(summary.cameraAttempts ? [{ tone: 'grape', label: '따라 하기', value: `${summary.cameraAttempts}회` }] : []),
  ];
  return <main className="sl-root lc" lang="ko" aria-labelledby="lc-title">
    <div className="lc-body">
      <div className="lc-hero"><Confetti /><Mascot mood="cheer" size={150} /></div>
      <h1 id="lc-title">{kind === 'lesson' ? '레슨 완료!' : '복습 완료!'}</h1>
      <p className="lc-sub">{kind === 'lesson' ? '새 표현을 경로에 담았어요.' : '다음 복습 날짜를 다시 정했어요.'}</p>
      <ul className={`lc-cards${cards.length === 4 ? ' is-four' : ''}`}>{cards.map(card => <li key={card.label} className={`lc-card is-${card.tone}`}><span>{card.label}</span><strong>{card.value}</strong></li>)}</ul>
    </div>
    <footer className="lc-footer"><div className="lc-footer-inner"><ChunkyButton ref={button} block onClick={onContinue}>계속</ChunkyButton></div></footer>
  </main>;
}

export function UnitComplete({ number, title, onContinue }: { number: number; title: string; onContinue: () => void }) {
  const button = useFocus();
  return <main className="sl-root lc lc-unit" lang="ko" aria-labelledby="uc-title">
    <div className="lc-body">
      <div className="lc-hero"><Confetti /><span className="lc-trophy"><Trophy size={84} strokeWidth={2.25} aria-hidden="true" /></span></div>
      <h1 id="uc-title">단원 {number} 완료!</h1>
      <p className="lc-sub">‘{title}’의 레슨과 단원 복습을 모두 마쳤어요.</p>
      <Mascot mood="cheer" size={96} />
    </div>
    <footer className="lc-footer"><div className="lc-footer-inner"><ChunkyButton ref={button} variant="sun" block onClick={onContinue}>계속</ChunkyButton></div></footer>
  </main>;
}
