import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ClipboardPaste, Plus, Trash2, WandSparkles } from 'lucide-react';
import {
  DIRECTION_LABELS, DIRECTIONS, exportConstraints, FACINGS, HANDSHAPES, KIND_LABELS, parseConstraints, POINT_NAMES, pointLabel, PRESET_IDS, spanLabel,
  type ConstraintInput, type ConstraintKind, type ConstraintResult, type ConstraintSet, type Direction, type Facing, type PointName, type PresetId,
} from '../motion/constraints';
import type { ConstraintReport } from '../motion/display';
import { activeRange, type LoopRange } from '../learn/loop';

type Props = {
  set: ConstraintSet | null; onSet: (set: ConstraintSet | null) => void;
  report: ConstraintReport | null; recorded: string | null;
  preview: boolean; onPreview: (on: boolean) => void; ghost: boolean; onGhost: (on: boolean) => void;
  time: number; duration: number; range: LoopRange; name: string; postEdits: number;
  onSeek: (seconds: number) => void; onExport: () => void; onError: (message: string) => void; busy: boolean;
};
type Draft = {
  kind: ConstraintKind; span: 'start' | 'middle' | 'end' | 'whole' | 'ab' | 'here'; note: string;
  hand: 'left' | 'right' | 'both'; a: PointName; b: PointName; tolerance: number; gap: number;
  preset: PresetId; facing: Facing; pointing: Direction | ''; axis: 'lateral' | 'vertical' | 'depth'; degrees: [number, number, number];
};
const KINDS = Object.keys(KIND_LABELS) as ConstraintKind[];
const SIDE_OPTIONS = [['both', '양손'], ['left', '왼손'], ['right', '오른손']] as const;
const STATUS: Record<string, string> = { ok: '적용', unavailable: '측정 불가', 'no-torso': '몸통 없음', unreachable: '팔이 닿지 않음', capped: '이동 상한', limited: '손목 제한' };
const format = (value: number | null | undefined, unit: 'm' | 'deg') => value == null ? '–' : unit === 'm' ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(1)}°`;
const scale = (unit: 'm' | 'deg') => unit === 'm' ? 100 : 1;
const download = (text: string, name: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** One constraint as JSON, from the add form. */
function build(d: Draft, id: string, time: number, range: LoopRange): ConstraintInput['constraints'][number] {
  const ab = activeRange(range);
  const span = d.span === 'ab' && ab ? { ms: [Math.round(ab.start * 1000), Math.round(ab.end * 1000)] as [number, number] }
    : d.span === 'here' ? { ms: [Math.max(0, Math.round(time * 1000 - 250)), Math.round(time * 1000 + 250)] as [number, number] }
    : { phase: (d.span === 'ab' ? 'whole' : d.span) as 'start' | 'middle' | 'end' | 'whole' };
  const common = { id, span, note: d.note.trim() };
  switch (d.kind) {
    case 'sameHeight': return { ...common, kind: 'sameHeight', points: [d.a, d.b], toleranceCm: d.tolerance };
    case 'contact': return { ...common, kind: 'contact', a: d.a, b: d.b, gapCm: d.gap, toleranceCm: d.tolerance };
    case 'symmetry': return { ...common, kind: 'symmetry', axis: d.axis, toleranceCm: d.tolerance };
    case 'handshape': return { ...common, kind: 'handshape', hand: d.hand, preset: d.preset };
    case 'palmFacing': return { ...common, kind: 'palmFacing', hand: d.hand, facing: d.facing, ...(d.pointing ? { pointing: d.pointing } : {}) };
    case 'hold': return { ...common, kind: 'hold', hand: d.hand };
    case 'wristOffset': return { ...common, kind: 'wristOffset', hand: d.hand === 'both' ? 'left' : d.hand, degrees: d.degrees };
  }
}

/** Residual over time for one constraint: before (gray) and after (blue), tolerance hairline, span core shaded. */
function ResidualChart({ result, time, duration, timestamps, onSeek }: { result: ConstraintResult; time: number; duration: number; timestamps: number[]; onSeek: (s: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 760, H = 190, L = 48, R = 12, T = 14, B = 26;
  const rows = result.rows, k = scale(result.unit), length = Math.max(duration, (timestamps.at(-1) ?? 0) / 1000, .001);
  const values = rows.flatMap(r => r ? [r.before, r.after].filter((x): x is number => x !== null) : []);
  const top = Math.max(result.tolerance * 1.5, ...values, 1e-6) * 1.1;
  const x = (seconds: number) => L + seconds / length * (W - L - R), y = (value: number) => T + (1 - value / top) * (H - T - B);
  const path = (key: 'before' | 'after') => {
    let d = '', open = false;
    rows.forEach((row, i) => {
      const value = row?.[key];
      if (value == null) { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(timestamps[i] / 1000).toFixed(1)},${y(value).toFixed(1)}`; open = true;
    });
    return d;
  };
  const active = rows.flatMap((row, i) => row ? [i] : []);
  const core = rows.flatMap((row, i) => row?.core ? [i] : []);
  const nearest = (seconds: number) => active.reduce((best, i) => Math.abs(timestamps[i] / 1000 - seconds) < Math.abs(timestamps[best] / 1000 - seconds) ? i : best, active[0]);
  const fromPointer = (event: { clientX: number }) => {
    const box = svg.current!.getBoundingClientRect(), px = (event.clientX - box.left) / box.width * W;
    return nearest((px - L) / (W - L - R) * length);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!active.length || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Enter')) return;
    event.preventDefault();
    const at = active.indexOf(hover ?? active[0]);
    if (event.key === 'Enter') { if (hover !== null) onSeek(timestamps[hover] / 1000); return; }
    setHover(active[Math.max(0, Math.min(active.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)))]);
  };
  const row = hover !== null ? rows[hover] : null;
  const summary = `${result.id} 잔차: 보정 전 최대 ${format(result.summary.before.max, result.unit)}, 보정 후 최대 ${format(result.summary.after.max, result.unit)}, 허용 ${format(result.tolerance, result.unit)}`;
  if (!active.length) return <p className="constraint-empty">이 조건의 구간에 해당하는 프레임이 없습니다.</p>;
  return <div className="residual-chart">
    <div className="residual-legend" aria-hidden="true"><span><i className="key-before" />보정 전</span><span><i className="key-after" />보정 후</span><span><i className="key-core" />구간 핵심(섞임 가중치 1)</span><span><i className="key-tolerance" />허용 오차</span></div>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} tabIndex={0} onKeyDown={onKey}
      onPointerMove={event => setHover(fromPointer(event))} onPointerLeave={() => setHover(null)} onClick={event => onSeek(timestamps[fromPointer(event)] / 1000)}>
      <title>{summary}. 화살표 키로 프레임을 고르고 Enter로 그 시각으로 이동합니다.</title>
      {core.length > 0 && <rect className="residual-core" x={x(timestamps[core[0]] / 1000)} y={T} width={Math.max(1, x(timestamps[core.at(-1)!] / 1000) - x(timestamps[core[0]] / 1000))} height={H - T - B} />}
      <line className="residual-axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      <line className="residual-tolerance" x1={L} x2={W - R} y1={y(result.tolerance)} y2={y(result.tolerance)} />
      <text className="residual-label" x={L - 6} y={y(0) + 4} textAnchor="end">0</text>
      <text className="residual-label" x={L - 6} y={T + 8} textAnchor="end">{(top * k).toFixed(result.unit === 'm' ? 1 : 0)}</text>
      <text className="residual-label" x={W - R - 4} y={y(result.tolerance) - 5} textAnchor="end">허용 {format(result.tolerance, result.unit)}</text>
      <text className="residual-label" x={L} y={H - 6}>0 s</text>
      <text className="residual-label" x={W - R} y={H - 6} textAnchor="end">{length.toFixed(2)} s · 단위 {result.unit === 'm' ? 'cm' : '°'}</text>
      <path className="residual-before" d={path('before')} />
      <path className="residual-after" d={path('after')} />
      <line className="residual-playhead" x1={x(time)} x2={x(time)} y1={T} y2={H - B} />
      {hover !== null && <line className="residual-crosshair" x1={x(timestamps[hover] / 1000)} x2={x(timestamps[hover] / 1000)} y1={T} y2={H - B} />}
    </svg>
    {row && hover !== null && <div className="residual-tooltip" role="status" style={{ left: `${x(timestamps[hover] / 1000) / W * 100}%` }}>
      <strong>{format(row.after, result.unit)}</strong> <span>보정 후</span><br /><strong>{format(row.before, result.unit)}</strong> <span>보정 전</span><br />
      <span>프레임 {hover} · {(timestamps[hover] / 1000).toFixed(2)} s · 가중치 {row.weight.toFixed(2)} · {STATUS[row.status]}</span>
    </div>}
    <details className="residual-table"><summary>프레임별 값 표</summary><div className="lab-scroll"><table>
      <thead><tr><th>프레임</th><th>시각 (s)</th><th>가중치</th><th>보정 전</th><th>보정 후</th><th>상태</th></tr></thead>
      <tbody>{active.map(i => <tr key={i}><td>{i}</td><td>{(timestamps[i] / 1000).toFixed(3)}</td><td>{rows[i]!.weight.toFixed(2)}</td><td>{format(rows[i]!.before, result.unit)}</td><td>{format(rows[i]!.after, result.unit)}</td><td>{STATUS[rows[i]!.status]}</td></tr>)}</tbody>
    </table></div></details>
  </div>;
}

/**
 * Motion Lab panel for constraint correction: list, add/remove, JSON import/paste/export, preview toggles, residual
 * chart and the corrected export. Constraint JSON may come from an LLM working outside the app (docs/CONSTRAINTS.md);
 * the app itself never calls one.
 */
export function ConstraintPanel(props: Props & { timestamps: number[] }) {
  const { set, onSet, report, preview, ghost, time, duration, range, timestamps, onError } = props;
  const [paste, setPaste] = useState(''), [selected, setSelected] = useState<string | null>(null), [open, setOpen] = useState(!!set);
  useEffect(() => { if (set) setOpen(true); }, [set]);
  const [draft, setDraft] = useState<Draft>({ kind: 'sameHeight', span: 'end', note: '', hand: 'both', a: 'left.wrist', b: 'right.wrist', tolerance: 1, gap: 0,
    preset: 'index', facing: 'inward', pointing: '', axis: 'lateral', degrees: [0, 0, 0] });
  const file = useRef<HTMLInputElement>(null);
  const results = useMemo(() => new Map(report?.constraints.map(r => [r.id, r]) ?? []), [report]);
  const chart = results.get(selected ?? '') ?? report?.constraints[0] ?? null;
  const update = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const load = (input: string | unknown) => { try { onSet(parseConstraints(input)); setSelected(null); return true; } catch (e) { onError(e instanceof Error ? e.message : String(e)); return false; } };
  function add() {
    const existing = set?.constraints ?? [];
    let n = existing.length + 1, id = `${draft.kind.toLowerCase()}-${n}`;
    while (existing.some(c => c.id === id)) id = `${draft.kind.toLowerCase()}-${++n}`;
    if (load({ format: 'signlingo.constraints', version: 1, ...(set?.expression ? { expression: set.expression } : {}), ...(set?.request ? { request: set.request } : {}),
      constraints: [...existing, build(draft, id, time, range)] })) { update({ note: '' }); setSelected(id); }
  }
  function remove(id: string) {
    const rest = set?.constraints.filter(c => c.id !== id) ?? [];
    onSet(rest.length && set ? { ...set, constraints: rest } : null);
  }
  const pointSelect = (label: string, value: PointName, key: 'a' | 'b') => <label>{label}<select aria-label={label} value={value} onChange={e => update({ [key]: e.target.value as PointName })}>
    {POINT_NAMES.map(p => <option key={p} value={p}>{pointLabel(p)} ({p})</option>)}</select></label>;
  const handSelect = (both = true) => <label>손<select aria-label="대상 손" value={draft.hand} onChange={e => update({ hand: e.target.value as Draft['hand'] })}>
    {SIDE_OPTIONS.filter(([v]) => both || v !== 'both').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <section className="constraint-panel" aria-label="제약 조건 보정">
    <button className="constraint-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><ChevronDown size={14} aria-hidden="true" />제약 조건 보정 <span>선택 사항 · 미리 본 뒤 보정본 내보내기 · LLM 없이 앱 안에서 계산</span></button>
    {open && <>
    <p className="constraint-limits">설명이나 수정 요청을 제약 조건(JSON)으로 옮겨 3D 동작을 고칩니다. 앱은 LLM을 부르지 않습니다. JSON은 사람이 쓰거나 <code>docs/CONSTRAINTS.md</code>를 붙여 넣은 외부 LLM이 씁니다. <strong>표정·비수지 신호와 관측되지 않은 미세한 손가락 움직임은 만들어 내지 않습니다.</strong> 손 모양 프리셋은 정해진 자세 하나이며, 보정 결과는 한국수어 검수를 대신하지 않습니다.</p>
    <div className="constraint-actions">
      <button className="button secondary" onClick={() => file.current?.click()}><ArrowUpFromLine size={15} />제약 조건 JSON 불러오기</button>
      <button className="button secondary" disabled={!set} onClick={() => set && download(exportConstraints(set), `${set.expression ?? props.name}.constraints.json`)}><ArrowDownToLine size={15} />제약 조건 JSON 내보내기</button>
      <button className="text-button" disabled={!set} onClick={() => onSet(null)}>모두 지우기</button>
      <label className="check"><input type="checkbox" checked={preview} disabled={!set} onChange={e => props.onPreview(e.target.checked)} />보정 미리보기</label>
      <label className="check"><input type="checkbox" checked={ghost} disabled={!set || !preview} onChange={e => props.onGhost(e.target.checked)} />보정 전 겹쳐 보기</label>
      <button className="button primary" disabled={!set || props.busy || props.postEdits > 0} onClick={props.onExport}><WandSparkles size={15} />보정본 내보내기</button>
    </div>
    <input ref={file} type="file" accept="application/json,.json" hidden aria-label="제약 조건 JSON 파일" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(await f.text()); }} />
    {props.recorded && <p className="constraint-note">이 동작은 제약 조건이 적용된 보정본입니다(해시 <code>{props.recorded.slice(0, 12)}…</code>). 미리보기와 다시 내보내기는 보정 전 원본 관측값에서 다시 계산합니다.</p>}
    {props.postEdits > 0 && <p className="constraint-note warning">보정본에 나중에 더한 손목 보정 {props.postEdits}건이 있습니다. 원본에서 다시 계산하면 사라지므로 wristOffset 조건으로 옮긴 뒤 내보내세요.</p>}
    {preview && set && <p className="constraint-note">미리보기는 저장된 프레임에 몸통 고정(켠 경우) 뒤 제약 조건을 적용해 보여 줍니다. 시간 복원은 쓰지 않습니다. <span className="constraint-swatch" aria-hidden="true" />파란 손은 보정한 손 모양, 흰 반투명은 보정 전입니다.</p>}
    <details className="constraint-paste"><summary><ClipboardPaste size={13} /> JSON 붙여넣기</summary>
      <textarea aria-label="제약 조건 JSON" value={paste} onChange={e => setPaste(e.target.value)} rows={8} placeholder='{"format":"signlingo.constraints","version":1,"constraints":[...]}' />
      <button className="button secondary" disabled={!paste.trim()} onClick={() => { if (load(paste)) setPaste(''); }}>붙여 넣은 JSON 적용</button>
    </details>
    {set && <div className="lab-scroll"><table className="constraint-table"><caption>제약 조건 {set.constraints.length}개{set.request ? ` · 요청: ${set.request}` : ''}</caption>
      <thead><tr><th>id</th><th>종류</th><th>구간</th><th>설명(note)</th><th>잔차 최대 전 → 후</th><th>만족</th><th /></tr></thead>
      <tbody>{set.constraints.map(c => { const r = results.get(c.id); return <tr key={c.id} className={chart?.id === c.id ? 'selected' : undefined}>
        <th><button className="text-button" aria-pressed={chart?.id === c.id} onClick={() => setSelected(c.id)}>{c.id}</button></th><td>{KIND_LABELS[c.kind]}</td><td>{spanLabel(c.span)}</td><td className="constraint-note-cell">{c.note}</td>
        <td>{r ? `${format(r.summary.before.max, r.unit)} → ${format(r.summary.after.max, r.unit)}` : '–'}</td><td>{r ? `${r.summary.satisfiedAfter} / ${r.summary.measuredCoreFrames}` : '–'}</td>
        <td><button className="text-button" aria-label={`${c.id} 삭제`} onClick={() => remove(c.id)}><Trash2 size={13} /></button></td></tr>; })}</tbody></table></div>}
    {preview && chart && <ResidualChart result={chart} time={time} duration={duration} timestamps={timestamps} onSeek={props.onSeek} />}
    <fieldset className="constraint-add"><legend>조건 추가</legend>
      <label>종류<select aria-label="조건 종류" value={draft.kind} onChange={e => update({ kind: e.target.value as ConstraintKind })}>{KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]} ({k})</option>)}</select></label>
      <label>구간<select aria-label="조건 구간" value={draft.span} onChange={e => update({ span: e.target.value as Draft['span'] })}>
        <option value="start">동작 구간 시작</option><option value="middle">동작 구간 중간</option><option value="end">동작 구간 끝</option><option value="whole">동작 구간 전체</option>
        <option value="ab" disabled={!activeRange(range)}>A–B 구간</option><option value="here">현재 시각 ±0.25초</option></select></label>
      {(draft.kind === 'sameHeight' || draft.kind === 'contact') && <>{pointSelect('점 A', draft.a, 'a')}{pointSelect('점 B', draft.b, 'b')}</>}
      {draft.kind === 'contact' && <label>목표 거리 (cm)<input type="number" min={0} max={30} step={.5} value={draft.gap} onChange={e => update({ gap: Number(e.target.value) })} /></label>}
      {(draft.kind === 'sameHeight' || draft.kind === 'contact' || draft.kind === 'symmetry') && <label>허용 오차 (cm)<input type="number" min={0} max={30} step={.5} value={draft.tolerance} onChange={e => update({ tolerance: Number(e.target.value) })} /></label>}
      {draft.kind === 'symmetry' && <label>축<select aria-label="대칭 축" value={draft.axis} onChange={e => update({ axis: e.target.value as Draft['axis'] })}><option value="lateral">좌우 거울 (lateral)</option><option value="vertical">위아래로 나란히 (vertical)</option><option value="depth">앞뒤로 나란히 (depth)</option></select></label>}
      {(draft.kind === 'handshape' || draft.kind === 'palmFacing' || draft.kind === 'hold') && handSelect()}
      {draft.kind === 'wristOffset' && handSelect(false)}
      {draft.kind === 'handshape' && <label>손 모양<select aria-label="손 모양 프리셋" value={draft.preset} onChange={e => update({ preset: e.target.value as PresetId })}>{PRESET_IDS.map(p => <option key={p} value={p}>{HANDSHAPES[p].label} ({p})</option>)}</select></label>}
      {draft.kind === 'palmFacing' && <><label>손바닥 방향<select aria-label="손바닥 방향" value={draft.facing} onChange={e => update({ facing: e.target.value as Facing })}>{FACINGS.map(f => <option key={f} value={f}>{DIRECTION_LABELS[f]} ({f})</option>)}</select></label>
        <label>손끝 방향<select aria-label="손끝 방향" value={draft.pointing} onChange={e => update({ pointing: e.target.value as Direction | '' })}><option value="">지정 안 함</option>{DIRECTIONS.map(f => <option key={f} value={f}>{DIRECTION_LABELS[f]} ({f})</option>)}</select></label></>}
      {draft.kind === 'wristOffset' && (['굽힘', '비틀림', '편위'] as const).map((label, i) => <label key={label}>{label} (°)<input type="number" min={-45} max={45} value={draft.degrees[i]} onChange={e => { const next = [...draft.degrees] as Draft['degrees']; next[i] = Number(e.target.value); update({ degrees: next }); }} /></label>)}
      <label className="constraint-note-input">설명 (note, 한국어)<input aria-label="조건 설명" value={draft.note} maxLength={500} placeholder="예: 양손이 같은 높이에서 만난다" onChange={e => update({ note: e.target.value })} /></label>
      <button className="button secondary" disabled={!draft.note.trim()} onClick={add}><Plus size={15} />조건 추가</button>
    </fieldset>
    </>}
  </section>;
}
