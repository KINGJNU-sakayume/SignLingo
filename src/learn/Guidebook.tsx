import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { ChunkyButton } from '../design/ChunkyButton';
import { Mascot } from '../design/Mascot';
import type { UnitModel } from './path';

type Props = { unit: UnitModel; onBack: () => void; onOpen: (expressionId: string) => void };

/** Unit reference: every published expression in the unit, opening the full expression card. */
export function Guidebook({ unit, onBack, onOpen }: Props) {
  return <section className="sl-root gb" lang="ko" aria-labelledby="gb-title">
    <ChunkyButton variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={20} strokeWidth={2.5} aria-hidden="true" />학습 경로</ChunkyButton>
    <header className={`gb-hero unit-${unit.soon ? 'soon' : unit.theme}`}>
      <p className="gb-kicker">단원 {unit.number} · {unit.category} · 가이드북</p>
      <h1 id="gb-title">{unit.title}</h1>
      <p>{unit.description}</p>
    </header>
    <p className="gb-note">표현 이름은 수어의 뜻을 옮긴 <strong>한국어 대응 표현</strong>이에요. 단어와 수어가 늘 일대일로 맞지는 않아요.</p>
    {unit.expressions.length ? <section aria-labelledby="gb-list">
      <h2 id="gb-list">이 단원의 표현</h2>
      <ul className="gb-list">{unit.expressions.map(entry => <li key={entry.id}>
        <button type="button" className="gb-item" onClick={() => onOpen(entry.id)}>
          <span><strong>{entry.displayName}</strong><small>{entry.meaning}</small><small className="gb-source">출처: {entry.source.owner}</small></span>
          <ChevronRight size={24} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </li>)}</ul>
    </section> : <section className="gb-empty">
      <Mascot mood="sleep" size={96} />
      <div><h2>준비 중이에요</h2><p>원본 이용 허락과 한국수어 검수를 마친 표현부터 열려요.</p>
        <a href="https://sldict.korean.go.kr/" target="_blank" rel="noreferrer">국립국어원 한국수어사전 <ExternalLink size={15} strokeWidth={2.5} aria-hidden="true" /></a></div>
    </section>}
    <footer className="gb-disclaimer">
      <p>3D 시범은 검수를 마친 원본 영상에서 복원한 동작이에요. 카메라 연습은 관찰된 움직임 차이를 보여 줄 뿐, 한국수어의 의미·문법·표정이 맞았다는 판정이 아니에요.</p>
      <p>학습 기록은 이 브라우저에만 저장되고 영상과 관절 데이터는 저장하지 않아요.</p>
    </footer>
  </section>;
}
