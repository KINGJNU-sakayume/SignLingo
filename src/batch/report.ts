// Per-clip extraction metrics and Korean summaries for the batch tools. Pure: reads a MotionClip, writes nothing.
// Every number is a tracking/display proxy, never a KSL accuracy or linguistic judgement.
import { displayFor, FILL_GUARD_REPORT, FILL_STAGE, TEMPORAL_STAGE, type DisplayHandState, type FillGuardReport, type FillReport, type TemporalReport } from '../motion/display';
import { HAND_REGION_DEFAULTS, handSeparation } from '../motion/handRegions';
import { assignHandsDetailed, wristInImage, type HandFate } from '../motion/tracking';
import { SIDES, type MotionClip, type MotionFrame, type Side } from '../motion/types';
import type { ExtractionMeasurements } from '../motion/timing';
import { activeInterval } from '../practice/features';
import { residualText, type BatchConstraintEntry } from './constraintReport';

export type MissingReason = 'torso' | 'offscreen' | 'arm' | 'degenerate' | 'ambiguous' | 'no-detection' | 'unassociated' | 'other';
export type StateCounts = {
  tracked: number; held: number; missing: number;
  /** Frames whose stored state is not `tracked` (held included) over the counted frames. */
  missingRate: number;
  /** Non-tracked frames whose pose wrist is outside the image or unreliable (`wristInImage`). */
  offscreen: number;
  /** Non-tracked frames with the torso present and the wrist inside the image: the detector or tracking failed. */
  onscreenFailure: number;
};
export type SideMetrics = StateCounts & {
  /** Tracked frames whose assigned hand came from a region crop (0.3.x). */
  regionTracked: number;
  reasons: Record<MissingReason, number>;
};
export type Interval = { start: number; end: number; method: string };
export type DiscardReason = Extract<HandFate, { discarded: string }>['discarded'];
export type DetectionMetrics = {
  /** Hands stored after detection (and 0.3.x region re-detection), by origin; 0.1.0/0.2.0 hands are full-frame. */
  stored: { frame: number; region: number };
  assigned: { frame: number; region: number };
  /** Stored hands tracking.ts did not assign to either side, and why. */
  discarded: { total: number; frame: number; region: number; reasons: Record<DiscardReason, number> };
  /** Stored hand pairs whose landmarks nearly coincide (the fusion's same-hand test), i.e. one hand stored twice. */
  nearDuplicatePairs: number;
};
export type LearnerSide = Record<DisplayHandState, number> & {
  fill: { lead: number; gap: number; trail: number };
  /** Frames the fill safeguard hid instead of filling or holding. */
  hidden: { 'insufficient-evidence': number; offscreen: number };
  /** Anchors ÷ arm-shown frames in the signing interval, and whether the side met the safeguard's minimum. */
  evidence: { fraction: number; sufficient: boolean };
};
export type ClipMetrics = {
  frames: number; duration: number; sampleHz: number; width: number; height: number;
  pipeline: { version: string; detector: string; handRegions: boolean };
  hands: Record<Side, SideMetrics>;
  /** The same counts inside the signing interval (`activeInterval`, or an override shared by compared versions). */
  active: Interval & { frames: number; hands: Record<Side, StateCounts> };
  detections: DetectionMetrics;
  /** Count of warning messages per normalized kind (one frame can carry several of a kind). */
  warnings: Record<string, number>;
  corrections: { total: number; frames: number; byKind: Record<string, number> };
  /** displayFor(clip, 'learner'): `interpolated` = 보간으로 메운 프레임, `fill` = 추정으로 채운 프레임 (exclusive final states). */
  learner: { temporal: { applied: boolean; reason?: string }; hands: Record<Side, LearnerSide> };
};

const KINDS: [RegExp, string][] = [
  [/^Torso tracking unavailable/, 'torso-unavailable'],
  [/^Monocular depth/, 'depth-estimate-notice'],
  [/^Head orientation unavailable/, 'head-unavailable'],
  [/^Ambiguous hand identity/, 'ambiguous-identity'],
  [/: arm landmarks unreliable/, 'arm-unreliable'],
  [/: no reliable wrist-associated hand/, 'no-associated-hand'],
  [/: palm or finger geometry degenerate/, 'hand-geometry-degenerate'],
  [/: last handshape held/, 'hand-held'],
  [/: elbow plane underdetermined/, 'elbow-underdetermined'],
  [/: suspected elbow-plane flip/, 'elbow-flip'],
  [/: elbow plane near singularity/, 'elbow-near-singularity'],
  [/: elbow plane changed/, 'elbow-plane-change'],
  [/: unusual wrist swing/, 'unusual-wrist-swing'],
  [/: rapid image-space wrist jump/, 'wrist-jump'],
  [/: wrist behind torso/, 'wrist-behind-torso'],
  [/fixed-rig reach correction/, 'reach-correction'],
  [/: unusual estimated articulation/, 'unusual-articulation'],
  [/FK direction residual/, 'fk-residual'],
  [/: sudden rotation/, 'sudden-rotation'],
  [/handedness label changed/, 'handedness-label-change'],
  [/cross-association proximity change/, 'identity-proximity-change'],
];
/** Stable id for a reconstruction warning: side, joint and numeric details are dropped. */
export const warningKind = (message: string) => KINDS.find(([pattern]) => pattern.test(message))?.[1] ?? 'other';

/** Why a side is not `tracked` in this stored frame. Off-screen wrists are separated from on-screen failures. */
export function missingReason(frame: MotionFrame, side: Side): MissingReason {
  const has = (text: string) => frame.warnings.some(w => w.startsWith(text));
  if (has('Torso tracking unavailable')) return 'torso';
  if (!wristInImage(frame, side)) return 'offscreen';
  if (has(`${side}: arm landmarks unreliable`)) return 'arm';
  if (has(`${side}: palm or finger geometry degenerate`)) return 'degenerate';
  if (has('Ambiguous hand identity') && frame.assignment[side] === undefined) return 'ambiguous';
  if (frame.assignment[side] === undefined) return frame.hands.length ? 'unassociated' : 'no-detection';
  return 'other';
}
/** Fate of every stored hand: its stored side, or why tracking.ts discarded it. */
export function handFates(frame: MotionFrame): HandFate[] {
  const detailed = assignHandsDetailed(frame);
  return frame.hands.map((_, i) => {
    const side = SIDES.find(s => frame.assignment[s] === i);
    if (side) return { side };
    const fate = detailed.fates[i];
    return 'discarded' in fate ? fate : { discarded: 'outcompeted' };
  });
}

function stateCounts(frames: readonly MotionFrame[], side: Side): StateCounts & { reasons: Record<MissingReason, number> } {
  const reasons: Record<MissingReason, number> = { torso: 0, offscreen: 0, arm: 0, degenerate: 0, ambiguous: 0, 'no-detection': 0, unassociated: 0, other: 0 };
  let tracked = 0, held = 0, missing = 0;
  for (const frame of frames) {
    const state = frame.pose.quality[`${side}State`];
    if (state === 'tracked') { tracked++; continue; }
    if (state === 'held') held++; else missing++;
    reasons[missingReason(frame, side)]++;
  }
  const offscreen = reasons.offscreen, onscreenFailure = held + missing - reasons.torso - reasons.offscreen;
  return { tracked, held, missing, missingRate: frames.length ? (frames.length - tracked) / frames.length : 0, offscreen, onscreenFailure, reasons };
}
const withoutReasons = ({ reasons: _reasons, ...counts }: StateCounts & { reasons: unknown }): StateCounts => counts;

function detectionMetrics(clip: MotionClip): DetectionMetrics {
  const result: DetectionMetrics = { stored: { frame: 0, region: 0 }, assigned: { frame: 0, region: 0 }, nearDuplicatePairs: 0,
    discarded: { total: 0, frame: 0, region: 0, reasons: { 'invalid-landmarks': 0, 'low-score': 0, 'no-reliable-wrist': 0, 'wrist-too-far': 0, 'ambiguous-crossing': 0, outcompeted: 0 } } };
  const { width, height } = clip.source, same = clip.pipeline.handRegions?.fusion.sameHand ?? HAND_REGION_DEFAULTS.fusion.sameHand;
  for (const frame of clip.frames) {
    handFates(frame).forEach((fate, i) => {
      const origin = frame.hands[i].origin === 'region' ? 'region' : 'frame';
      result.stored[origin]++;
      if ('side' in fate) { result.assigned[origin]++; return; }
      result.discarded.total++; result.discarded[origin]++; result.discarded.reasons[fate.discarded]++;
    });
    for (let a = 0; a < frame.hands.length; a++) for (let b = a + 1; b < frame.hands.length; b++)
      if (frame.hands[a].image.length === 21 && frame.hands[b].image.length === 21 && handSeparation(frame.hands[a], frame.hands[b], width, height) < same) result.nearDuplicatePairs++;
  }
  return result;
}

export function clipMetrics(clip: MotionClip, options: { interval?: Interval } = {}): ClipMetrics {
  const frames = clip.frames, total = frames.length;
  const hands = Object.fromEntries(SIDES.map(side => {
    const regionTracked = frames.filter(f => f.pose.quality[`${side}State`] === 'tracked' && f.assignment[side] !== undefined && f.hands[f.assignment[side]!]?.origin === 'region').length;
    return [side, { ...stateCounts(frames, side), regionTracked }];
  })) as Record<Side, SideMetrics>;
  const interval = options.interval ?? activeInterval(clip);
  const inside = frames.filter(f => f.timestamp / 1000 >= interval.start - 1e-6 && f.timestamp / 1000 <= interval.end + 1e-6);
  const active = { start: interval.start, end: interval.end, method: interval.method, frames: inside.length,
    hands: Object.fromEntries(SIDES.map(side => [side, withoutReasons(stateCounts(inside, side))])) as Record<Side, StateCounts> };
  const warnings: Record<string, number> = {};
  for (const frame of frames) for (const message of frame.warnings) { const kind = warningKind(message); warnings[kind] = (warnings[kind] ?? 0) + 1; }
  const byKind: Record<string, number> = {};
  for (const frame of frames) for (const c of frame.corrections) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  const display = displayFor(clip, 'learner');
  const fill = display.reports[FILL_STAGE] as FillReport | undefined, temporal = display.reports[TEMPORAL_STAGE] as TemporalReport | undefined;
  const guard = display.reports[FILL_GUARD_REPORT] as FillGuardReport | undefined;
  const learner = Object.fromEntries(SIDES.map(side => {
    const states: Record<DisplayHandState, number> = { observed: 0, interpolated: 0, held: 0, filled: 0, constrained: 0, missing: 0 };
    for (const frame of display.frames) states[frame.annotation.hands[side].state]++;
    const g = guard?.sides[side];
    return [side, { ...states, fill: { ...(fill?.[side] ?? { lead: 0, gap: 0, trail: 0 }) },
      hidden: { ...(g?.hidden ?? { 'insufficient-evidence': 0, offscreen: 0 }) }, evidence: { fraction: g?.fraction ?? 0, sufficient: g?.sufficient ?? true } }];
  })) as Record<Side, LearnerSide>;
  return {
    frames: total, duration: clip.source.duration, sampleHz: clip.source.sampleHz, width: clip.source.width, height: clip.source.height,
    pipeline: { version: clip.pipeline.version, detector: clip.pipeline.detector, handRegions: !!clip.pipeline.handRegions?.enabled },
    hands, active, detections: detectionMetrics(clip), warnings,
    corrections: { total: frames.reduce((n, f) => n + f.corrections.length, 0), frames: frames.filter(f => f.corrections.length).length, byKind },
    learner: { temporal: { applied: !!temporal?.applied, ...(temporal?.reason ? { reason: temporal.reason } : {}) }, hands: learner },
  };
}
/** One interval covering both versions' signing intervals, so compared missing rates share a denominator. */
export const unionInterval = (a: Interval, b: Interval): Interval => ({ start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), method: a.method === b.method ? a.method : `${a.method}+${b.method}` });

// ---- report documents -------------------------------------------------------------------------------

export type Environment = {
  generatedAt: string; browser?: string; models?: Record<string, { url: string; sha256: string }>;
  wasm?: { package: string; sha256: Record<string, string> };
};
export type ClipEntry = {
  file: string; bytes: number; sha256: string; pipeline: string; sampleHz: number; mirrored: boolean;
  output?: string; error?: string; measurements?: Pick<ExtractionMeasurements, 'requests' | 'observations' | 'inferenceFps' | 'analysisFps' | 'elapsedMs' | 'backend'>;
  metrics?: ClipMetrics;
  /** motion:batch --constraints: the constraint file applied right after recognition (the output is a version-2 clip). */
  constraints?: BatchConstraintEntry;
};
export type BatchReport = { format: 'signlingo.motion-batch'; version: 1; environment: Environment; clips: ClipEntry[]; notice: string };
export type CompareReport = { format: 'signlingo.motion-compare'; version: 1; environment: Environment; sampleHz: number; mirrored: boolean; versions: string[];
  clips: { file: string; bytes: number; sha256: string; runs: Record<string, ClipEntry> }[]; notice: string };
export const NOTICE = 'Tracking and display proxies only: no KSL accuracy, no linguistic review. Derived from private source videos; do not commit or share without authorization.';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pair = (l: number | string, r: number | string) => `${l} / ${r}`;
const fills = (s: LearnerSide) => `${s.fill.lead}·${s.fill.gap}·${s.fill.trail}`;
const hiddenTotal = (s: LearnerSide) => s.hidden['insufficient-evidence'] + s.hidden.offscreen;
const seconds = (i: Interval) => `${i.start.toFixed(2)}–${i.end.toFixed(2)} s`;
const topDiscards = (d: DetectionMetrics) => Object.entries(d.discarded.reasons).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const escape = (text: string) => text.replace(/\|/g, '\\|');
function environmentLines(env: Environment): string[] {
  return [
    `- 생성: ${env.generatedAt}`,
    ...(env.browser ? [`- 브라우저: ${env.browser}`] : []),
    ...Object.entries(env.models ?? {}).map(([name, m]) => `- 모델 ${name}: \`${m.url}\` SHA-256 \`${m.sha256}\``),
    ...(env.wasm ? [`- WASM: ${env.wasm.package} (${Object.keys(env.wasm.sha256).length}개 파일, SHA-256은 JSON 보고서)`] : []),
  ];
}
const DEFINITIONS = [
  '- **누락률**: 저장된 손 상태가 `tracked`가 아닌 프레임(held 포함) ÷ 프레임 수. **동작 구간** 누락률은 `activeInterval`(Practice의 동작 구간 추정) 안의 프레임만 셉니다. 비교표는 두 버전 구간의 합집합을 같이 씁니다.',
  '- **화면 밖**: 누락 프레임 중 pose 손목이 화면 밖(가장자리 2%)이거나 신뢰도 0.45 미만. **화면 안 실패**: 몸통이 있고 손목이 화면 안인데 추적하지 못한 프레임.',
  '- **held**: 복원기가 마지막 손 모양을 ≤200 ms 유지한 프레임(신뢰도 0).',
  '- **보간**: 학습자 표시(`displayFor(clip, \'learner\')`)에서 시간 복원이 앞뒤 관측 사이를 메운 프레임. 0.3.x 클립에만 적용됩니다.',
  '- **채움 앞·중간·뒤**: 같은 학습자 표시에서 손 채우기가 첫 관측 전·관측 사이·마지막 관측 후를 추정으로 채운 프레임. 보간과 겹치지 않습니다.',
  '- **숨김**: 손 채우기 안전장치가 채우는 대신 숨긴 프레임(관측 근거 부족 또는 손목이 화면 밖).',
  '- **버림**: 저장된 손 중 tracking.ts가 어느 쪽에도 배정하지 않은 손. **중복 쌍**: 같은 손이 두 번 저장된 것으로 보이는 쌍(융합의 같은 손 기준).',
];

export function batchMarkdown(report: BatchReport): string {
  const ok = report.clips.filter(c => c.metrics);
  const rows = ok.map(c => { const m = c.metrics!, l = m.learner.hands; return [escape(c.file), `${m.frames}`,
    pair(pct(m.hands.left.missingRate), pct(m.hands.right.missingRate)), pair(pct(m.active.hands.left.missingRate), pct(m.active.hands.right.missingRate)),
    pair(m.active.hands.left.offscreen, m.active.hands.right.offscreen), pair(m.active.hands.left.onscreenFailure, m.active.hands.right.onscreenFailure),
    pair(m.hands.left.held, m.hands.right.held), pair(m.hands.left.regionTracked, m.hands.right.regionTracked), `${m.corrections.total}`,
    pair(l.left.interpolated, l.right.interpolated), pair(fills(l.left), fills(l.right)), pair(hiddenTotal(l.left), hiddenTotal(l.right))]; });
  const details = ok.map(c => {
    const m = c.metrics!, d = m.detections;
    const reasons = SIDES.map(side => `  - ${side === 'left' ? '왼손' : '오른손'}: ${Object.entries(m.hands[side].reasons).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || '없음'}`);
    const warnings = Object.entries(m.warnings).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '없음';
    const corrections = Object.entries(m.corrections.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || '없음';
    const evidence = SIDES.map(side => { const s = m.learner.hands[side]; return `${side === 'left' ? '왼손' : '오른손'} ${(s.evidence.fraction * 100).toFixed(0)}%${s.evidence.sufficient ? '' : ' (부족: 채우지 않음)'}`; }).join(', ');
    return [`### ${escape(c.file)}`, `- 파이프라인 ${m.pipeline.version}${m.pipeline.handRegions ? ' (손 영역 재검출)' : ''}, ${m.width}×${m.height}, ${m.sampleHz} Hz, ${m.duration.toFixed(2)} s, SHA-256 \`${c.sha256}\``,
      ...(c.measurements ? [`- 추론 ${c.measurements.inferenceFps?.toFixed(1) ?? '-'} FPS, 전체 ${c.measurements.analysisFps?.toFixed(1) ?? '-'} FPS, 관측 ${c.measurements.observations}/${c.measurements.requests}`] : []),
      `- 동작 구간 ${seconds(m.active)} (${m.active.method}, ${m.active.frames}프레임)`,
      '- 누락 원인 (전체 프레임 수)', ...reasons,
      `- 손 검출: 저장 frame ${d.stored.frame} / region ${d.stored.region}, 배정 frame ${d.assigned.frame} / region ${d.assigned.region}, 버림 ${d.discarded.total} (frame ${d.discarded.frame} / region ${d.discarded.region}; ${topDiscards(d)}), 중복 쌍 ${d.nearDuplicatePairs}`,
      `- 경고 종류별 개수: ${warnings}`, `- 보정 ${m.corrections.total}회 (${m.corrections.frames}프레임): ${corrections}`,
      `- 학습자 표시 시간 복원: ${m.learner.temporal.applied ? '적용' : `미적용 (${m.learner.temporal.reason ?? '-'})`}`,
      `- 손 채우기 관측 근거(동작 구간): ${evidence}`].join('\n');
  });
  const failed = report.clips.filter(c => c.error).map(c => `- ${escape(c.file)}: ${escape(c.error!)}`);
  const constrained = report.clips.filter(c => c.constraints).map(c => { const k = c.constraints!;
    return `- ${escape(c.file)}: \`${escape(k.file)}\` (SHA-256 \`${k.sha256.slice(0, 12)}…\`, ${k.count}개, 바뀐 프레임 ${k.changedFrames}) — ${k.results.map(r => `${escape(r.id)} ${residualText(r.beforeMax, r.unit)} → ${residualText(r.afterMax, r.unit)} (만족 ${r.satisfiedAfter}/${r.measuredCoreFrames})`).join(', ')}`; });
  return ['# 동작 일괄 처리 보고서', '', ...environmentLines(report.environment), '', ...DEFINITIONS, '',
    table(['클립', '프레임', '누락률 왼/오', '동작 구간 누락률 왼/오', '화면 밖 왼/오 (구간)', '화면 안 실패 왼/오 (구간)', 'held 왼/오', '영역 재검출로 추적 왼/오', '보정', '보간 왼/오', '채움 왼 / 오 (앞·중간·뒤)', '숨김 왼/오'], rows), '',
    ...(failed.length ? ['## 실패', ...failed, ''] : []),
    ...(constrained.length ? ['## 인식 직후 적용한 제약 조건 (잔차 최대: 전 → 후, 구간 핵심 프레임)', ...constrained, ''] : []),
    '## 클립별 상세', '', details.join('\n\n'), '', `> ${report.notice}`, ''].join('\n');
}

export function compareMarkdown(report: CompareReport): string {
  const rows: string[][] = [], activeRows: string[][] = [], detectionRows: string[][] = [], failures: string[] = [];
  const zero = () => ({ left: 0, right: 0 });
  const totals = Object.fromEntries(report.versions.map(v => [v, { frames: 0, activeFrames: 0, notTracked: zero(), activeNotTracked: zero(), offscreen: zero(), onscreen: zero(), held: zero(), interpolated: zero(), filled: zero(), hidden: zero() }]));
  for (const clip of report.clips) for (const version of report.versions) {
    const run = clip.runs[version], m = run?.metrics;
    if (!m) { rows.push([escape(clip.file), version, '실패', '-', '-', '-', '-', '-', '-', '-']); failures.push(`- ${escape(clip.file)} (${version}): ${escape(run?.error ?? '결과 없음')}`); continue; }
    const t = totals[version], l = m.learner.hands, a = m.active.hands, d = m.detections;
    t.frames += m.frames; t.activeFrames += m.active.frames;
    for (const side of SIDES) {
      t.notTracked[side] += m.frames - m.hands[side].tracked; t.activeNotTracked[side] += m.active.frames - a[side].tracked;
      t.offscreen[side] += a[side].offscreen; t.onscreen[side] += a[side].onscreenFailure; t.held[side] += m.hands[side].held;
      t.interpolated[side] += l[side].interpolated; t.filled[side] += l[side].filled; t.hidden[side] += hiddenTotal(l[side]);
    }
    rows.push([escape(clip.file), version, `${m.frames}`, pct(m.hands.left.missingRate), pct(m.hands.right.missingRate),
      pair(m.hands.left.held, m.hands.right.held), pair(l.left.interpolated, l.right.interpolated), fills(l.left), fills(l.right), pair(hiddenTotal(l.left), hiddenTotal(l.right))]);
    activeRows.push([escape(clip.file), version, seconds(m.active), `${m.active.frames}`, pct(a.left.missingRate), pct(a.right.missingRate),
      pair(a.left.offscreen, a.right.offscreen), pair(a.left.onscreenFailure, a.right.onscreenFailure)]);
    detectionRows.push([escape(clip.file), version, pair(d.stored.frame, d.stored.region), pair(d.assigned.frame, d.assigned.region),
      `${d.discarded.total} (${pair(d.discarded.frame, d.discarded.region)})`, topDiscards(d), `${d.nearDuplicatePairs}`]);
  }
  const rate = (n: number, of: number) => of ? pct(n / of) : '-';
  const summary = report.versions.map(v => { const t = totals[v]; return [v, `${t.frames}`, rate(t.notTracked.left, t.frames), rate(t.notTracked.right, t.frames),
    rate(t.activeNotTracked.left, t.activeFrames), rate(t.activeNotTracked.right, t.activeFrames), pair(t.offscreen.left, t.offscreen.right), pair(t.onscreen.left, t.onscreen.right),
    pair(t.held.left, t.held.right), pair(t.interpolated.left, t.interpolated.right), pair(t.filled.left, t.filled.right), pair(t.hidden.left, t.hidden.right)]; });
  return [`# 파이프라인 ${report.versions.join(' / ')} 비교`, '', ...environmentLines(report.environment),
    `- 조건: 같은 영상·같은 브라우저 세션, ${report.sampleHz} Hz, 좌우 반전 ${report.mirrored ? '예' : '아니요'}, 분석 최대 960 px`, '', ...DEFINITIONS, '',
    table(['클립', '버전', '프레임', '왼손 누락률', '오른손 누락률', 'held 왼/오', '보간 왼/오', '채움 왼손 앞·중간·뒤', '채움 오른손 앞·중간·뒤', '채움 대신 숨김 왼/오'], rows), '',
    '## 동작 구간 (두 버전 구간의 합집합)', '', table(['클립', '버전', '구간', '프레임', '왼손 누락률', '오른손 누락률', '화면 밖 왼/오', '화면 안 실패 왼/오'], activeRows), '',
    '## 손 검출 출처와 tracking에서 버린 손', '', table(['클립', '버전', '저장 frame/region', '배정 frame/region', '버림 (frame/region)', '주요 버림 사유', '중복 쌍'], detectionRows), '',
    ...(failures.length ? ['## 실패 (합계에서 제외)', ...failures, ''] : []),
    '## 전체 (프레임 가중)', '', table(['버전', '프레임', '왼손 누락률', '오른손 누락률', '구간 왼손 누락률', '구간 오른손 누락률', '구간 화면 밖 왼/오', '구간 화면 안 실패 왼/오', 'held 왼/오', '보간 왼/오', '채움 합계 왼/오', '숨김 왼/오'], summary), '',
    `> ${report.notice}`, ''].join('\n');
}
