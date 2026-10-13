import { ChevronRight, ExternalLink } from 'lucide-react';
import type { Catalog, Expression } from '../content/schema';
import { progressKey } from '../lessons/catalog';
import { ChunkyButton } from '../design/ChunkyButton';
import { Mascot } from '../design/Mascot';
import { dueExpressions, learnedExpressions, nextReviewDate, relativeDay } from './review';
import type { LearnStore } from './storage';

export const REVIEW_TARGETS = 4;
type Props = { catalog: Catalog; store: LearnStore; now: Date; onStart: (targets: Expression[]) => void; onOpen: (entry: Expression) => void };

function DueSummary({ catalog, store, now, onStart, compact }: Omit<Props, 'onOpen'> & { compact?: boolean }) {
  const due = dueExpressions(store, catalog.expressions, now), next = nextReviewDate(store, catalog.expressions);
  if (!due.length) return <div className="rv-empty">
    <Mascot mood="sleep" size={compact ? 64 : 96} />
    <div><p className="rv-empty-title">지금은 복습할 표현이 없어요</p>
      <p className="rv-muted">{next ? `다음 복습: ${relativeDay(next, now)}` : '레슨을 마치면 복습할 표현이 여기에 모여요.'}</p></div>
  </div>;
  return <div className="rv-due">
    <p className="rv-due-title">복습할 표현 {due.length}개</p>
    <ul className="rv-chips">{due.slice(0, 6).map(entry => <li key={entry.id}>{entry.displayName}</li>)}</ul>
    <ChunkyButton variant={compact ? 'sky' : 'primary'} block onClick={() => onStart(due.slice(0, REVIEW_TARGETS))}>복습 시작</ChunkyButton>
  </div>;
}

/** Bottom-tab "복습": due expressions only (Leitner schedule), plus everything learned so far. */
export function ReviewView(props: Props) {
  const { catalog, store, now, onOpen } = props;
  const learned = learnedExpressions(store, catalog.expressions);
  return <main className="sl-root rv" lang="ko" aria-labelledby="rv-title">
    <h1 id="rv-title">복습</h1>
    <p className="rv-lead">맞힌 표현은 점점 간격을 늘려 다시 보여 드려요.</p>
    <section className="rv-card" aria-label="오늘의 복습"><DueSummary {...props} /></section>
    {!!learned.length && <section aria-labelledby="rv-learned"><h2 id="rv-learned">익힌 표현 {learned.length}개</h2>
      <ul className="rv-list">{learned.map(entry => <li key={entry.id}><button type="button" className="gb-item" onClick={() => onOpen(entry)}>
        <span><strong>{entry.displayName}</strong><small>다음 복습: {relativeDay(new Date(store.expressions[progressKey(entry)].due), now)}</small></span>
        <ChevronRight size={24} strokeWidth={2.5} aria-hidden="true" /></button></li>)}</ul>
    </section>}
  </main>;
}

/** Desktop right rail beside the learning path. */
export function RightRail(props: Omit<Props, 'onOpen'>) {
  return <aside className="sl-root rail" aria-label="학습 도우미">
    <section className="rail-card" aria-labelledby="rail-due"><h2 id="rail-due">오늘 복습할 표현</h2><DueSummary {...props} compact /></section>
    <section className="rail-card" aria-labelledby="rail-guide"><h2 id="rail-guide">학습 안내</h2>
      <ul className="rail-notes">
        <li>한국수어는 고유한 언어예요. 표정도 뜻을 바꿔요.</li>
        <li>출처와 검수 정보는 단원 가이드북에 있어요.</li>
        <li>학습 기록은 이 브라우저에만 저장돼요.</li>
      </ul>
      <a href="https://sldict.korean.go.kr/" target="_blank" rel="noreferrer">국립국어원 한국수어사전 <ExternalLink size={15} strokeWidth={2.5} aria-hidden="true" /></a>
    </section>
  </aside>;
}
