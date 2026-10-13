import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink, LocateFixed } from 'lucide-react';
import { ChunkyButton } from '../design/ChunkyButton';
import { Mascot } from '../design/Mascot';
import { PathNode, type NodeState } from '../design/PathNode';
import { UnitBanner } from '../design/UnitBanner';
import type { Catalog } from '../content/schema';
import { estimateMinutes, type PathModel, type PathNodeModel, type UnitModel } from './path';

type Props = {
  path: PathModel; catalog: Catalog; celebrate: string[];
  onStart: (node: PathNodeModel, kind: 'lesson' | 'review') => void;
  onGuidebook: (unitId: string) => void;
};
const STATE_TEXT: Record<NodeState, string> = { current: '지금 할 차례', completed: '완료', 'review-due': '복습할 때예요', locked: '잠김', 'coming-soon': '준비 중' };

export function nodeTitle(unit: UnitModel, node: PathNodeModel) {
  if (node.kind === 'review') return `단원 ${unit.number} 단원 복습`;
  if (node.kind === 'trophy') return `단원 ${unit.number} 트로피`;
  return `단원 ${unit.number} 레슨 ${node.lessonNumber}`;
}
function nodeLabel(unit: UnitModel, node: PathNodeModel) {
  return node.kind === 'soon' ? '준비 중 · 아직 시작할 수 없어요' : `${nodeTitle(unit, node)} · ${STATE_TEXT[node.state]}`;
}

function Popover({ unit, node, id, onStart }: { unit: UnitModel; node: PathNodeModel; id: string; onStart: Props['onStart'] }) {
  const locked = node.state === 'locked';
  const heading = node.kind === 'lesson' ? `레슨 ${node.lessonNumber} / ${node.lessonCount}` : node.kind === 'review' ? '단원 복습' : `단원 ${unit.number} 트로피`;
  let detail = node.kind === 'lesson' ? `새 표현 ${node.expressions.length}개 · 약 ${estimateMinutes(node)}분`
    : node.kind === 'review' ? `표현 ${node.expressions.length}개 다시 보기 · 약 ${estimateMinutes(node)}분` : '';
  if (node.kind === 'trophy') detail = node.state === 'completed' ? '이 단원을 모두 마쳤어요!' : '단원 복습까지 마치면 받을 수 있어요';
  else if (locked) detail = '앞의 레슨을 마치면 열려요';
  else if (node.state === 'review-due') detail = '복습할 때가 된 표현이 있어요';
  return <div id={id} className={`pv-popover${locked || node.kind === 'trophy' ? ' is-muted' : ''}`} role="group" aria-label={heading}>
    <p className="pv-popover-title">{heading}</p>
    <p className="pv-popover-detail">{detail}</p>
    {node.kind !== 'trophy' && (locked
      ? <ChunkyButton variant="inverse" block disabled>잠겨 있어요</ChunkyButton>
      : node.state === 'review-due'
        ? <><ChunkyButton variant="inverse" block onClick={() => onStart(node, 'review')}>복습 시작</ChunkyButton>
          <button type="button" className="pv-popover-link" onClick={() => onStart(node, 'lesson')}>레슨 다시 하기</button></>
        : <ChunkyButton variant="inverse" block onClick={() => onStart(node, node.kind === 'review' ? 'review' : 'lesson')}>
          {node.state === 'completed' ? '다시 하기' : '시작'}</ChunkyButton>)}
  </div>;
}

export function PathView({ path, catalog, celebrate, onStart, onGuidebook }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const currentRef = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null);
  const toCurrent = (behavior: ScrollBehavior) => currentRef.current?.scrollIntoView({ block: 'center', behavior });
  useEffect(() => { if (path.current) toCurrent('auto'); }, [path.current?.id]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) { if (event.key !== 'Escape') return; document.querySelector<HTMLButtonElement>(`[aria-controls="pv-pop-${CSS.escape(open)}"]`)?.focus(); }
      else if (event.target instanceof Element && event.target.closest('.pv-node-row')) return;
      setOpen(null);
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return <div className="pv" ref={root}>
    {!path.hasContent && <section className="pv-empty" aria-labelledby="pv-empty-title">
      <Mascot mood="idle" size={96} />
      <div><h2 id="pv-empty-title">첫 레슨을 준비하고 있어요</h2>
        <p>그동안 국립국어원 한국수어사전에서 수어를 둘러볼 수 있어요.</p>
        <a href="https://sldict.korean.go.kr/" target="_blank" rel="noreferrer">한국수어사전 열기 <ExternalLink size={16} strokeWidth={2.5} aria-hidden="true" /></a></div>
    </section>}
    {path.units.map((unit, unitIndex) => <section key={unit.id} className={`pv-unit unit-${unit.soon ? 'soon' : unit.theme}`} aria-labelledby={`unit-${unit.id}`}>
      <UnitBanner id={`unit-${unit.id}`} number={unit.number} category={unit.category} title={unit.title} theme={unit.theme} soon={unit.soon} onGuidebook={() => onGuidebook(unit.id)} />
      <div className={`pv-track${unitIndex % 2 ? ' swing-left' : ''}`}>
        {unit.nodes.map(node => {
          const popover = `pv-pop-${node.id}`;
          return <div key={node.id} className={`pv-node-row${open === node.id ? ' is-open' : ''}${node.state === 'current' ? ' is-current' : ''}`} style={{ '--offset': `${node.offset}px` } as CSSProperties}>
            <PathNode ref={node.state === 'current' ? currentRef : undefined} state={node.state} kind={node.kind === 'soon' ? 'lesson' : node.kind}
              label={nodeLabel(unit, node)} expanded={open === node.id} controls={popover} celebrate={celebrate.includes(node.id)}
              onClick={() => setOpen(value => value === node.id ? null : node.id)} />
            {open === node.id && <Popover unit={unit} node={node} id={popover} onStart={(n, kind) => { setOpen(null); onStart(n, kind); }} />}
          </div>;
        })}
        <Mascot className="pv-mascot" mood={unit.soon ? 'sleep' : unit.completed ? 'cheer' : 'idle'} size={unit.soon ? 88 : 104} />
      </div>
      {unit.soon && <p className="pv-soon">준비 중이에요 · 원본 이용 허락과 한국수어 검수를 마친 표현부터 열려요</p>}
    </section>)}
    {!!catalog.expressions.length && path.current && <button type="button" className="pv-locate" aria-label="현재 위치로 이동" onClick={() => toCurrent('smooth')}>
      <LocateFixed size={26} strokeWidth={2.5} aria-hidden="true" /></button>}
  </div>;
}
