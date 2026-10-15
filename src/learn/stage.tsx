import { FlipHorizontal2, Repeat1, Turtle, X } from 'lucide-react';
import type { CameraView } from '../components/Avatar';
import type { Expression } from '../content/schema';
import { activeRange, formatSeconds, NO_LOOP, type LoopRange } from './loop';

/** Shared controls and labels around the 3D demonstration on the learning screens. */
export const VIEW_LABELS: Record<CameraView, string> = { front: '정면', side: '측면', first: '1인칭', hands: '손 확대' };

export function ViewPicker({ views, value, onChange, label = '시범 시점' }: { views: readonly CameraView[]; value: CameraView; onChange: (view: CameraView) => void; label?: string }) {
  return <div className="sl-segmented" role="group" aria-label={label}>
    {views.map(view => <button type="button" key={view} aria-pressed={value === view} onClick={() => onChange(view)}>{VIEW_LABELS[view]}</button>)}
  </div>;
}
export function SpeedToggle({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  return <button type="button" className="sl-toggle" aria-pressed={speed === .5} onClick={() => onChange(speed === .5 ? 1 : .5)}>
    <Turtle size={22} strokeWidth={2.5} aria-hidden="true" /><span>0.5배속</span></button>;
}
export function MirrorToggle({ mirror, onToggle }: { mirror: boolean; onToggle: () => void }) {
  return <button type="button" className="sl-toggle" aria-pressed={mirror} onClick={onToggle}
    title="아바타를 거울처럼 좌우로 뒤집어 보여 줘요. 손 색과 실제 좌우는 그대로예요.">
    <FlipHorizontal2 size={20} strokeWidth={2.5} aria-hidden="true" /><span>거울 모드</span></button>;
}
/** Always visible on the stage while the mirrored image is shown; first person is never mirrored. */
export function MirrorBadge({ mirror, view }: { mirror: boolean; view: CameraView }) {
  if (!mirror) return null;
  return view === 'first'
    ? <span className="sl-mirror-badge is-off">1인칭 · 거울 모드 꺼짐</span>
    : <span className="sl-mirror-badge"><FlipHorizontal2 size={16} strokeWidth={2.75} aria-hidden="true" />거울 모드</span>;
}
export function FilledLegend() {
  return <p className="sl-filled-legend"><i aria-hidden="true" />추정으로 채운 손 모양</p>;
}
/** Hands a reviewed constraint correction set (corrected motion); not an observation. */
export function ConstrainedLegend() {
  return <p className="sl-filled-legend sl-constrained-legend"><i aria-hidden="true" />보정한 손 모양</p>;
}
/** Expert-written description and movement notes for the demonstration being watched. */
export function ExpressionCaption({ items }: { items: { entry: Expression; label?: string }[] }) {
  return <div className="sl-caption">
    {items.map(({ entry, label }) => <section key={entry.id + (label ?? '')} aria-label={`${label ? label + ' · ' : ''}${entry.displayName} 설명`}>
      {label && <p className="sl-caption-label">{label} · {entry.displayName}</p>}
      <p className="sl-caption-text">{entry.description}</p>
      {!!entry.movementNotes.length && <ul className="sl-caption-notes" aria-label="움직임 살펴보기">{entry.movementNotes.map(note => <li key={note}>{note}</li>)}</ul>}
    </section>)}
  </div>;
}
export function LoopControls({ range, time, onChange }: { range: LoopRange; time: number; onChange: (range: LoopRange) => void }) {
  const section = activeRange(range);
  return <div className="sl-loop" role="group" aria-label="구간 반복">
    <button type="button" className="sl-toggle" aria-pressed={range.a !== null} aria-label="구간 시작(A) 지정" onClick={() => onChange({ ...range, a: time })}><Repeat1 size={18} strokeWidth={2.5} aria-hidden="true" />A</button>
    <button type="button" className="sl-toggle" aria-pressed={range.b !== null} aria-label="구간 끝(B) 지정" disabled={range.a === null} onClick={() => onChange({ ...range, b: time })}>B</button>
    {(range.a !== null || range.b !== null) && <button type="button" className="sl-toggle" aria-label="구간 반복 해제" onClick={() => onChange(NO_LOOP)}><X size={18} strokeWidth={2.75} aria-hidden="true" />구간 해제</button>}
    <span className="sl-loop-status" aria-live="polite">{section ? `구간 반복 ${formatSeconds(section.start)}–${formatSeconds(section.end)}` : range.a !== null ? `A ${formatSeconds(range.a)} · B를 지정하세요` : ''}</span>
  </div>;
}
/** Scrubber with the A–B section drawn under the thumb. */
export function Scrubber({ value, duration, range, label, onSeek, className = '' }: { value: number; duration: number; range: LoopRange; label: string; onSeek: (value: number) => void; className?: string }) {
  const section = activeRange(range), total = duration || 1;
  return <div className={`sl-scrub ${className}`}>
    {section && <span className="sl-scrub-loop" aria-hidden="true" style={{ left: `${section.start / total * 100}%`, width: `${(section.end - section.start) / total * 100}%` }} />}
    <input aria-label={label} type="range" min={0} max={total} step="0.01" value={value} onChange={event => onSeek(Number(event.target.value))} />
  </div>;
}
