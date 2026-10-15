// Before/after residuals of a constraint correction and what it changed. Pure: reads clips, writes nothing.
// Every number is avatar geometry, never a KSL accuracy or linguistic judgement.
import { LENGTHS } from '../motion/math';
import { forwardArm } from '../motion/rig';
import { exportMotion, importMotion } from '../motion/serialization';
import { KIND_LABELS, sourceClip, type ConstraintSet, type ConstraintSolution, type ResolvedSpan, type SigningInterval, type Stats } from '../motion/constraints';
import { SIDES, type MotionClip, type Side } from '../motion/types';

export const CONSTRAINT_NOTICE = 'Avatar-geometry residuals of a constraint correction: not KSL accuracy and not a linguistic review. Facial expression, nonmanual signals and unobserved fine finger movement are never generated.';
export type ConstraintResultRow = {
  id: string; kind: string; note: string; unit: 'm' | 'deg'; tolerance: number; span: ResolvedSpan | null;
  activeFrames: number; coreFrames: number; measuredCoreFrames: number;
  unavailableFrames: number; unreachableFrames: number; cappedFrames: number; limitedFrames: number;
  before: Stats; after: Stats; satisfiedBefore: number; satisfiedAfter: number;
};
export type ConstraintReport = {
  format: 'signlingo.constraint-report'; version: 1; generatedAt: string;
  motion: { file: string; bytes: number; sha256: string; version: 1 | 2; pipeline: string; frames: number; sampleHz: number; duration: number };
  constraints: { file: string; sha256: string; count: number; expression?: string; request?: string };
  interval: SigningInterval;
  results: ConstraintResultRow[];
  changes: {
    frames: number; totalFrames: number;
    /** Changed frames outside every resolved span (0 unless baked source wrist edits changed them). */
    outsideSpans: number; sourceEdits: number;
    /** Changed frames per rig joint. */
    joints: Record<string, number>;
    hands: Record<Side, { observed: number; constrained: number }>;
  };
  integrity: { maxArmLengthErrorMeters: number; maxShoulderShiftMeters: number; landmarksUnchanged: boolean; qualityUnchanged: boolean; roundTrip: boolean };
  notice: string;
};

/** Report data for a corrected clip, its source and the stored-frame solution that produced it. */
export function constraintReport(input: {
  motion: ConstraintReport['motion']; constraintFile: string; constraintSha256: string; set: ConstraintSet;
  source: MotionClip; corrected: MotionClip; solution: ConstraintSolution; generatedAt?: string;
}): ConstraintReport {
  const { source, corrected, solution, set } = input;
  const spans = solution.constraints.map(c => c.span).filter((s): s is ResolvedSpan => !!s);
  const changed = corrected.frames.flatMap((f, i) => f.constraint ? [i] : []);
  const joints: Record<string, number> = {}, hands = { left: { observed: 0, constrained: 0 }, right: { observed: 0, constrained: 0 } };
  for (const i of changed) {
    const record = corrected.frames[i].constraint!;
    for (const joint of record.joints) joints[joint] = (joints[joint] ?? 0) + 1;
    for (const side of SIDES) if (record.evidence[side]) hands[side][record.evidence[side]!]++;
  }
  let maxArmLengthErrorMeters = 0, maxShoulderShiftMeters = 0;
  corrected.frames.forEach((frame, i) => {
    for (const side of SIDES) {
      const arm = forwardArm(frame.pose, side), before = forwardArm(source.frames[i].pose, side);
      maxArmLengthErrorMeters = Math.max(maxArmLengthErrorMeters, Math.abs(arm.elbow.distanceTo(arm.shoulder) - LENGTHS.upper), Math.abs(arm.wrist.distanceTo(arm.elbow) - LENGTHS.lower));
      maxShoulderShiftMeters = Math.max(maxShoulderShiftMeters, arm.shoulder.distanceTo(before.shoulder));
    }
  });
  const same = (pick: (clip: MotionClip) => unknown) => JSON.stringify(pick(corrected)) === JSON.stringify(pick(source));
  const reloaded = importMotion(exportMotion(corrected));
  return {
    format: 'signlingo.constraint-report', version: 1, generatedAt: input.generatedAt ?? new Date().toISOString(),
    motion: input.motion,
    constraints: { file: input.constraintFile, sha256: input.constraintSha256, count: set.constraints.length,
      ...(set.expression ? { expression: set.expression } : {}), ...(set.request ? { request: set.request } : {}) },
    interval: solution.interval,
    results: solution.constraints.map(c => ({ id: c.id, kind: c.kind, note: c.note, unit: c.unit, tolerance: c.tolerance, span: c.span, ...c.summary })),
    changes: {
      frames: changed.length, totalFrames: corrected.frames.length,
      outsideSpans: changed.filter(i => !spans.some(s => i >= s.firstFrame && i <= s.lastFrame)).length,
      sourceEdits: corrected.constraints?.sourceEdits.length ?? 0, joints, hands,
    },
    integrity: { maxArmLengthErrorMeters, maxShoulderShiftMeters,
      landmarksUnchanged: same(c => c.frames.map(f => [f.timestamp, f.body, f.bodyWorld, f.hands, f.assignment])),
      qualityUnchanged: same(c => c.frames.map(f => [f.pose.quality, f.warnings, f.corrections])),
      roundTrip: JSON.stringify(sourceClip(reloaded)) === JSON.stringify(source) && reloaded.constraints?.sha256 === input.constraintSha256 },
    notice: CONSTRAINT_NOTICE,
  };
}

const KINDS: Record<string, string> = KIND_LABELS;
export const residualText = (value: number | null, unit: 'm' | 'deg') => value === null ? '-' : unit === 'm' ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(1)}°`;
const stats = (s: Stats, unit: 'm' | 'deg') => `${residualText(s.max, unit)} / ${residualText(s.mean, unit)}`;
const spanText = (span: ResolvedSpan | null) => span ? `${(span.startMs / 1000).toFixed(2)}–${(span.endMs / 1000).toFixed(2)} s (프레임 ${span.firstFrame}–${span.lastFrame})` : '선택된 프레임 없음';
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const escape = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function constraintMarkdown(report: ConstraintReport): string {
  const m = report.motion, c = report.constraints, ch = report.changes, g = report.integrity;
  const rows = report.results.map(r => [escape(r.id), KINDS[r.kind] ?? r.kind, spanText(r.span), residualText(r.tolerance, r.unit), `${r.activeFrames}`, `${r.coreFrames}`,
    stats(r.before, r.unit), stats(r.after, r.unit), `${r.satisfiedBefore} → ${r.satisfiedAfter} / ${r.measuredCoreFrames}`,
    `${r.unavailableFrames}`, `${r.unreachableFrames}`, `${r.cappedFrames}`, `${r.limitedFrames}`]);
  const jointRows = Object.entries(ch.joints).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([joint, n]) => [joint, `${n}`]);
  return ['# 제약 조건 보정 보고서', '',
    `- 생성: ${report.generatedAt}`,
    `- 동작: \`${m.file}\` (SHA-256 \`${m.sha256}\`, MotionClip v${m.version}, 파이프라인 ${m.pipeline}, ${m.frames}프레임, ${m.sampleHz} Hz, ${m.duration.toFixed(2)} s)`,
    `- 제약 조건: \`${c.file}\` (canonical SHA-256 \`${c.sha256}\`, ${c.count}개${c.expression ? `, 표현 ${c.expression}` : ''})`,
    ...(c.request ? [`- 요청 원문: ${escape(c.request)}`] : []),
    `- 동작 구간(activeInterval): ${report.interval.start.toFixed(2)}–${report.interval.end.toFixed(2)} s (${report.interval.method}). phase·fraction 구간의 기준입니다.`,
    '- 기준: 저장된 프레임(손목 수동 보정 반영). 시간 복원·몸통 고정·손 채우기 같은 표시 후처리는 넣지 않았습니다.', '',
    '## 조건별 잔차', '',
    '잔차는 구간의 핵심 프레임(섞임 가중치 1)에서 잰 값입니다. 최대 / 평균. 허용 오차 이하이면 만족으로 셉니다.', '',
    table(['id', '종류', '구간', '허용', '적용 프레임', '핵심 프레임', '전 (최대/평균)', '후 (최대/평균)', '만족 전 → 후 / 측정', '측정 불가', '도달 불가', '이동 상한', '손목 제한'], rows), '',
    '- 측정 불가: 팔이 숨겨졌거나, 위치 조건에서 손이 관측되지 않은 프레임(관측 없는 손은 옮기지 않습니다). 도달 불가: 고정 팔 길이로 닿지 않음. 이동 상한: `maxShiftCm`에 걸림. 손목 제한: 손목 관절 제한으로 덜 돌림.', '',
    '## 바뀐 관절과 프레임', '',
    `- 바뀐 프레임: ${ch.frames} / ${ch.totalFrames} (모든 구간 밖에서 바뀐 프레임 ${ch.outsideSpans}, 원본 손목 수동 보정 ${ch.sourceEdits}건 반영)`,
    `- 바뀐 관절: ${Object.keys(ch.joints).length}개`,
    `- 손별 근거: 왼손 관측값 보정 ${ch.hands.left.observed} · 관측 없이 생성(constrained) ${ch.hands.left.constrained} / 오른손 관측값 보정 ${ch.hands.right.observed} · 관측 없이 생성 ${ch.hands.right.constrained}`, '',
    table(['관절', '바뀐 프레임'], jointRows), '',
    '## 무결성', '',
    `- 팔 길이 최대 오차: ${(g.maxArmLengthErrorMeters * 1000).toExponential(1)} mm · 어깨 이동 최대: ${(g.maxShoulderShiftMeters * 1000).toExponential(1)} mm`,
    `- 랜드마크·손 배정: ${g.landmarksUnchanged ? '그대로' : '바뀜'} · 품질·경고·복원 보정 기록: ${g.qualityUnchanged ? '그대로' : '바뀜'} · 다시 읽어 원본 복원: ${g.roundTrip ? '일치' : '불일치'}`, '',
    '## 한계', '',
    '- 표정·비수지 신호, 관측되지 않은 미세한 손가락 움직임은 새로 만들지 않습니다. 손 모양 프리셋은 정해진 자세 하나입니다.',
    '- 잔차는 아바타 기하 지표이며 한국수어로서 맞는지는 알려 주지 않습니다. 보정본은 다시 두 검수를 받아야 합니다.', '',
    `> ${report.notice}`, ''].join('\n');
}

/** Short per-clip summary kept in motion:batch reports. */
export type BatchConstraintEntry = { file: string; sha256: string; count: number; changedFrames: number;
  results: { id: string; unit: 'm' | 'deg'; beforeMax: number | null; afterMax: number | null; satisfiedAfter: number; measuredCoreFrames: number }[] };
export function batchConstraintEntry(file: string, sha256: string, corrected: MotionClip, solution: ConstraintSolution): BatchConstraintEntry {
  return { file, sha256, count: solution.constraints.length, changedFrames: corrected.frames.filter(f => f.constraint).length,
    results: solution.constraints.map(c => ({ id: c.id, unit: c.unit, beforeMax: c.summary.before.max, afterMax: c.summary.after.max, satisfiedAfter: c.summary.satisfiedAfter, measuredCoreFrames: c.summary.measuredCoreFrames })) };
}
