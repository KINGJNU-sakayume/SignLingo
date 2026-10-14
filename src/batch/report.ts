// Per-clip extraction metrics and Korean summaries for the batch tools. Pure: reads a MotionClip, writes nothing.
// Every number is a tracking/display proxy, never a KSL accuracy or linguistic judgement.
import { displayFor, FILL_STAGE, TEMPORAL_STAGE, type DisplayHandState, type FillReport, type TemporalReport } from '../motion/display';
import { SIDES, type MotionClip, type MotionFrame, type Side } from '../motion/types';
import type { ExtractionMeasurements } from '../motion/timing';

export type MissingReason = 'torso' | 'arm' | 'degenerate' | 'ambiguous' | 'no-detection' | 'unassociated' | 'other';
export type SideMetrics = {
  tracked: number; held: number; missing: number;
  /** Frames whose stored state is not `tracked` (held included) over all frames. */
  missingRate: number;
  /** Tracked frames whose assigned hand came from a region crop (0.3.0). */
  regionTracked: number;
  reasons: Record<MissingReason, number>;
};
export type LearnerSide = Record<DisplayHandState, number> & { fill: { lead: number; gap: number; trail: number } };
export type ClipMetrics = {
  frames: number; duration: number; sampleHz: number; width: number; height: number;
  pipeline: { version: string; detector: string; handRegions: boolean };
  hands: Record<Side, SideMetrics>;
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

function missingReason(frame: MotionFrame, side: Side): MissingReason {
  const has = (text: string) => frame.warnings.some(w => w.startsWith(text));
  if (has('Torso tracking unavailable')) return 'torso';
  if (has(`${side}: arm landmarks unreliable`)) return 'arm';
  if (has(`${side}: palm or finger geometry degenerate`)) return 'degenerate';
  if (has('Ambiguous hand identity') && frame.assignment[side] === undefined) return 'ambiguous';
  if (frame.assignment[side] === undefined) return frame.hands.length ? 'unassociated' : 'no-detection';
  return 'other';
}

export function clipMetrics(clip: MotionClip): ClipMetrics {
  const frames = clip.frames, total = frames.length;
  const hands = Object.fromEntries(SIDES.map(side => {
    const reasons: Record<MissingReason, number> = { torso: 0, arm: 0, degenerate: 0, ambiguous: 0, 'no-detection': 0, unassociated: 0, other: 0 };
    let tracked = 0, held = 0, missing = 0, regionTracked = 0;
    for (const frame of frames) {
      const state = frame.pose.quality[`${side}State`];
      if (state === 'tracked') {
        tracked++;
        const index = frame.assignment[side];
        if (index !== undefined && frame.hands[index]?.origin === 'region') regionTracked++;
        continue;
      }
      if (state === 'held') held++; else missing++;
      reasons[missingReason(frame, side)]++;
    }
    return [side, { tracked, held, missing, missingRate: total ? (total - tracked) / total : 0, regionTracked, reasons }];
  })) as Record<Side, SideMetrics>;
  const warnings: Record<string, number> = {};
  for (const frame of frames) for (const message of frame.warnings) { const kind = warningKind(message); warnings[kind] = (warnings[kind] ?? 0) + 1; }
  const byKind: Record<string, number> = {};
  for (const frame of frames) for (const c of frame.corrections) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  const display = displayFor(clip, 'learner');
  const fill = display.reports[FILL_STAGE] as FillReport | undefined, temporal = display.reports[TEMPORAL_STAGE] as TemporalReport | undefined;
  const learner = Object.fromEntries(SIDES.map(side => {
    const states: Record<DisplayHandState, number> = { observed: 0, interpolated: 0, held: 0, filled: 0, missing: 0 };
    for (const frame of display.frames) states[frame.annotation.hands[side].state]++;
    return [side, { ...states, fill: { ...(fill?.[side] ?? { lead: 0, gap: 0, trail: 0 }) } }];
  })) as Record<Side, LearnerSide>;
  return {
    frames: total, duration: clip.source.duration, sampleHz: clip.source.sampleHz, width: clip.source.width, height: clip.source.height,
    pipeline: { version: clip.pipeline.version, detector: clip.pipeline.detector, handRegions: !!clip.pipeline.handRegions?.enabled },
    hands, warnings,
    corrections: { total: frames.reduce((n, f) => n + f.corrections.length, 0), frames: frames.filter(f => f.corrections.length).length, byKind },
    learner: { temporal: { applied: !!temporal?.applied, ...(temporal?.reason ? { reason: temporal.reason } : {}) }, hands: learner },
  };
}

// ---- report documents -------------------------------------------------------------------------------

export type Environment = {
  generatedAt: string; browser?: string; models?: Record<string, { url: string; sha256: string }>;
  wasm?: { package: string; sha256: Record<string, string> };
};
export type ClipEntry = {
  file: string; bytes: number; sha256: string; pipeline: string; sampleHz: number; mirrored: boolean;
  output?: string; error?: string; measurements?: Pick<ExtractionMeasurements, 'requests' | 'observations' | 'inferenceFps' | 'analysisFps' | 'elapsedMs' | 'backend'>;
  metrics?: ClipMetrics;
};
export type BatchReport = { format: 'signlingo.motion-batch'; version: 1; environment: Environment; clips: ClipEntry[]; notice: string };
export type CompareReport = { format: 'signlingo.motion-compare'; version: 1; environment: Environment; sampleHz: number; mirrored: boolean; versions: string[];
  clips: { file: string; bytes: number; sha256: string; runs: Record<string, ClipEntry> }[]; notice: string };
export const NOTICE = 'Tracking and display proxies only: no KSL accuracy, no linguistic review. Derived from private source videos; do not commit or share without authorization.';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fills = (s: LearnerSide) => `${s.fill.lead}·${s.fill.gap}·${s.fill.trail}`;
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
  '- **누락률**: 저장된 손 상태가 `tracked`가 아닌 프레임(held 포함) ÷ 전체 프레임.',
  '- **held**: 복원기가 마지막 손 모양을 ≤200 ms 유지한 프레임(신뢰도 0).',
  '- **보간**: 학습자 표시(`displayFor(clip, \'learner\')`)에서 시간 복원이 앞뒤 관측 사이를 메운 프레임. 0.3.0 클립에만 적용됩니다.',
  '- **채움 앞·중간·뒤**: 같은 학습자 표시에서 손 채우기 단계가 첫 관측 전·관측 사이·마지막 관측 후를 추정으로 채운 프레임. 보간과 겹치지 않습니다.',
];

export function batchMarkdown(report: BatchReport): string {
  const ok = report.clips.filter(c => c.metrics);
  const rows = ok.map(c => { const m = c.metrics!; return [escape(c.file), `${m.frames}`, pct(m.hands.left.missingRate), pct(m.hands.right.missingRate),
    `${m.hands.left.held} / ${m.hands.right.held}`, `${m.hands.left.regionTracked} / ${m.hands.right.regionTracked}`, `${m.corrections.total}`,
    `${m.learner.hands.left.interpolated} / ${m.learner.hands.right.interpolated}`, `${fills(m.learner.hands.left)} / ${fills(m.learner.hands.right)}`]; });
  const details = ok.map(c => {
    const m = c.metrics!;
    const reasons = SIDES.map(side => `  - ${side === 'left' ? '왼손' : '오른손'}: ${Object.entries(m.hands[side].reasons).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || '없음'}`);
    const warnings = Object.entries(m.warnings).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '없음';
    const corrections = Object.entries(m.corrections.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || '없음';
    return [`### ${escape(c.file)}`, `- 파이프라인 ${m.pipeline.version}${m.pipeline.handRegions ? ' (손 영역 재검출)' : ''}, ${m.width}×${m.height}, ${m.sampleHz} Hz, ${m.duration.toFixed(2)} s, SHA-256 \`${c.sha256}\``,
      ...(c.measurements ? [`- 추론 ${c.measurements.inferenceFps?.toFixed(1) ?? '-'} FPS, 전체 ${c.measurements.analysisFps?.toFixed(1) ?? '-'} FPS, 관측 ${c.measurements.observations}/${c.measurements.requests}`] : []),
      '- 누락 원인 (프레임 수)', ...reasons,
      `- 경고 종류별 개수: ${warnings}`, `- 보정 ${m.corrections.total}회 (${m.corrections.frames}프레임): ${corrections}`,
      `- 학습자 표시 시간 복원: ${m.learner.temporal.applied ? '적용' : `미적용 (${m.learner.temporal.reason ?? '-'})`}`].join('\n');
  });
  const failed = report.clips.filter(c => c.error).map(c => `- ${escape(c.file)}: ${escape(c.error!)}`);
  return ['# 동작 일괄 처리 보고서', '', ...environmentLines(report.environment), '', ...DEFINITIONS, '',
    table(['클립', '프레임', '왼손 누락률', '오른손 누락률', 'held 왼/오', '영역 재검출로 추적 왼/오', '보정', '보간 왼/오', '채움 왼 앞·중간·뒤 / 오'], rows), '',
    ...(failed.length ? ['## 실패', ...failed, ''] : []), '## 클립별 상세', '', details.join('\n\n'), '', `> ${report.notice}`, ''].join('\n');
}

export function compareMarkdown(report: CompareReport): string {
  const rows: string[][] = [], failures: string[] = [];
  const totals = Object.fromEntries(report.versions.map(v => [v, { frames: 0, notTracked: { left: 0, right: 0 }, held: { left: 0, right: 0 }, interpolated: { left: 0, right: 0 }, filled: { left: 0, right: 0 } }]));
  for (const clip of report.clips) for (const version of report.versions) {
    const run = clip.runs[version], m = run?.metrics;
    if (!m) { rows.push([escape(clip.file), version, '실패', '-', '-', '-', '-', '-', '-']); failures.push(`- ${escape(clip.file)} (${version}): ${escape(run?.error ?? '결과 없음')}`); continue; }
    const t = totals[version]; t.frames += m.frames;
    for (const side of SIDES) {
      t.notTracked[side] += m.frames - m.hands[side].tracked; t.held[side] += m.hands[side].held;
      t.interpolated[side] += m.learner.hands[side].interpolated; t.filled[side] += m.learner.hands[side].filled;
    }
    rows.push([escape(clip.file), version, `${m.frames}`, pct(m.hands.left.missingRate), pct(m.hands.right.missingRate),
      `${m.hands.left.held} / ${m.hands.right.held}`, `${m.learner.hands.left.interpolated} / ${m.learner.hands.right.interpolated}`,
      fills(m.learner.hands.left), fills(m.learner.hands.right)]);
  }
  const summary = report.versions.map(v => { const t = totals[v]; return [v, `${t.frames}`, t.frames ? pct(t.notTracked.left / t.frames) : '-', t.frames ? pct(t.notTracked.right / t.frames) : '-',
    `${t.held.left} / ${t.held.right}`, `${t.interpolated.left} / ${t.interpolated.right}`, `${t.filled.left} / ${t.filled.right}`]; });
  return ['# 파이프라인 0.2.0 / 0.3.0 비교', '', ...environmentLines(report.environment),
    `- 조건: 같은 영상·같은 브라우저 세션, ${report.sampleHz} Hz, 좌우 반전 ${report.mirrored ? '예' : '아니요'}, 분석 최대 960 px`, '', ...DEFINITIONS, '',
    table(['클립', '버전', '프레임', '왼손 누락률', '오른손 누락률', 'held 왼/오', '보간 왼/오', '채움 왼손 앞·중간·뒤', '채움 오른손 앞·중간·뒤'], rows), '',
    ...(failures.length ? ['## 실패 (합계에서 제외)', ...failures, ''] : []),
    '## 전체 (프레임 가중)', '', table(['버전', '프레임', '왼손 누락률', '오른손 누락률', 'held 왼/오', '보간 왼/오', '채움 합계 왼/오'], summary), '',
    `> ${report.notice}`, ''].join('\n');
}
