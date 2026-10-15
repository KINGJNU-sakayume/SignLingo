// Frame-by-frame 0.2.0 / 0.3.x diagnostics for `motion:compare --trace <clip>`. Pure.
// Records numbers and coordinates only: candidate counts, crop boxes, labels, scores, tracking decisions and
// hand states. No pixels, images, thumbnails or landmarks are written.
import type { FusionDrop, FusionTrace } from '../motion/handRegions';
import { HAND_REGION_DEFAULTS, handSeparation } from '../motion/handRegions';
import { EXPERIMENTAL_PIPELINE } from '../motion/pipeline';
import { wristInImage } from '../motion/tracking';
import { SIDES, type MotionClip, type Side, type TrackingState } from '../motion/types';
import { handFates, missingReason, type DiscardReason, type MissingReason } from './report';

export type FusionRecord = FusionTrace & { timestamp: number };
export type TraceHand = { origin: 'frame' | 'region'; label: string; score: number; side?: Side; discarded?: DiscardReason };
export type TraceFrame = {
  index: number; timestamp: number;
  candidates: { frame: number; region: number };
  /** Sides without a full-frame hand, and why no region ran (0.3.1 only). */
  gaps?: Side[]; skipped?: FusionTrace['skipped'];
  /** Predicted crop boxes in crop-source pixels (region pipelines only). */
  regions: FusionTrace['regions'] | null;
  /** Hands kept after fusion, as stored, with what tracking.ts did with each. */
  hands: TraceHand[];
  fusionDropped: FusionDrop[];
  /** Stored hand pairs that look like one hand stored twice. */
  duplicatePairs: number;
  sides: Record<Side, { state: TrackingState; offscreen: boolean; reason?: MissingReason }>;
};
export type TraceRun = { pipeline: string; fusionRecorded: boolean; cropSource?: { width: number; height: number }; frames: TraceFrame[] };
export type TraceReport = { format: 'signlingo.motion-trace'; version: 1; clip: string; sha256: string; sampleHz: number; runs: Record<string, TraceRun>; notice: string };
export const TRACE_NOTICE = 'Numbers and coordinates only (no pixels, images or landmarks). Derived from a private video: do not commit or share without authorization.';

export function traceRun(clip: MotionClip, fusion: readonly FusionRecord[] = []): TraceRun {
  const byTime = new Map(fusion.map(f => [f.timestamp, f]));
  const { width, height } = clip.source, same = clip.pipeline.handRegions?.fusion.sameHand ?? HAND_REGION_DEFAULTS.fusion.sameHand;
  const frames = clip.frames.map((frame, index): TraceFrame => {
    const record = byTime.get(frame.timestamp), fates = handFates(frame);
    let duplicatePairs = 0;
    for (let a = 0; a < frame.hands.length; a++) for (let b = a + 1; b < frame.hands.length; b++)
      if (frame.hands[a].image.length === 21 && frame.hands[b].image.length === 21 && handSeparation(frame.hands[a], frame.hands[b], width, height) < same) duplicatePairs++;
    return {
      index, timestamp: frame.timestamp,
      candidates: record?.candidates ?? { frame: frame.hands.length, region: 0 },
      ...(record ? { gaps: record.gaps, ...(record.skipped ? { skipped: record.skipped } : {}) } : {}),
      regions: record?.regions ?? null,
      hands: frame.hands.map((h, i) => ({ origin: h.origin ?? 'frame', label: h.label, score: h.score, ...fates[i] })),
      fusionDropped: record?.dropped ?? [], duplicatePairs,
      sides: Object.fromEntries(SIDES.map(side => {
        const state = frame.pose.quality[`${side}State`];
        return [side, { state, offscreen: !wristInImage(frame, side), ...(state === 'tracked' ? {} : { reason: missingReason(frame, side) }) }];
      })) as TraceFrame['sides'],
    };
  });
  return { pipeline: clip.pipeline.version, fusionRecorded: fusion.length > 0, ...(fusion[0] ? { cropSource: fusion[0].source } : {}), frames };
}

export function buildTrace(clip: string, sha256: string, clips: Record<string, MotionClip>, fusion: Record<string, readonly FusionRecord[]> = {}): TraceReport {
  const any = Object.values(clips)[0];
  return { format: 'signlingo.motion-trace', version: 1, clip, sha256, sampleHz: any?.source.sampleHz ?? 0,
    runs: Object.fromEntries(Object.entries(clips).map(([version, c]) => [version, traceRun(c, fusion[version])])), notice: TRACE_NOTICE };
}

type Change = { side: Side; kind: 'worse' | 'better' | 'other'; a: TraceFrame; b: TraceFrame };
/** Reason labels counted in one version's frame for one side: tracking discards, fusion drops, the side's missing reason, duplicates. */
function reasons(frame: TraceFrame, side: Side): string[] {
  const out = frame.hands.flatMap(h => h.discarded ? [`tracking 버림: ${h.discarded}`] : []);
  out.push(...frame.fusionDropped.map(d => `영역 후보 제외: ${d.reason} (${d.side === 'left' ? '왼쪽' : '오른쪽'} 영역)`));
  const s = frame.sides[side];
  if (s.reason) out.push(`${side === 'left' ? '왼손' : '오른손'} 상태 원인: ${s.reason}`);
  for (let i = 0; i < frame.duplicatePairs; i++) out.push('저장: 같은 손 중복');
  return out;
}

/** Human summary: where the region pipeline changed a hand's state relative to 0.2.0, and which reasons grew in the worsened frames. */
export function traceMarkdown(report: TraceReport, base = '0.2.0', other: string = EXPERIMENTAL_PIPELINE): string {
  const a = report.runs[base], b = report.runs[other];
  const lines = [`# 프레임 추적: ${report.clip}`, '', `- SHA-256 \`${report.sha256}\`, ${report.sampleHz} Hz`, `- 비교: ${base} → ${other}`, `- ${report.notice}`, ''];
  if (!a || !b) return [...lines, `두 버전의 결과가 모두 있어야 비교할 수 있습니다 (있는 버전: ${Object.keys(report.runs).join(', ') || '없음'}).`, ''].join('\n');
  const other0 = new Map(b.frames.map(f => [f.timestamp, f]));
  const changes: Change[] = [];
  for (const fa of a.frames) {
    const fb = other0.get(fa.timestamp);
    if (!fb) continue;
    for (const side of SIDES) {
      const sa = fa.sides[side].state, sb = fb.sides[side].state;
      if (sa === sb) continue;
      changes.push({ side, a: fa, b: fb, kind: sa === 'tracked' ? 'worse' : sb === 'tracked' ? 'better' : 'other' });
    }
  }
  const counts = (run: TraceRun, side: Side) => { const c = { tracked: 0, held: 0, missing: 0 }; for (const f of run.frames) c[f.sides[side].state]++; return c; };
  lines.push('## 손 상태 합계', '', `| 손 | ${base} tracked·held·missing | ${other} tracked·held·missing | 악화 | 개선 | 기타 |`, '| --- | --- | --- | --- | --- | --- |');
  for (const side of SIDES) {
    const ca = counts(a, side), cb = counts(b, side), k = (kind: Change['kind']) => changes.filter(c => c.side === side && c.kind === kind).length;
    lines.push(`| ${side === 'left' ? '왼손' : '오른손'} | ${ca.tracked}·${ca.held}·${ca.missing} | ${cb.tracked}·${cb.held}·${cb.missing} | ${k('worse')} | ${k('better')} | ${k('other')} |`);
  }
  lines.push('', '## 손 상태가 바뀐 구간', '');
  const label = { worse: '악화', better: '개선', other: '기타(held↔missing)' } as const;
  for (const side of SIDES) {
    const mine = changes.filter(c => c.side === side);
    lines.push(`### ${side === 'left' ? '왼손' : '오른손'}`, '');
    if (!mine.length) { lines.push('- 바뀐 프레임 없음', ''); continue; }
    lines.push('| 프레임 | 시간 | 구분 | 바뀐 상태 |', '| --- | --- | --- | --- |');
    let start = 0;
    for (let i = 1; i <= mine.length; i++) {
      if (i < mine.length && mine[i].kind === mine[start].kind && mine[i].a.index === mine[i - 1].a.index + 1) continue;
      const run = mine.slice(start, i), transitions = new Map<string, number>();
      for (const c of run) { const key = `${c.a.sides[side].state}→${c.b.sides[side].state}`; transitions.set(key, (transitions.get(key) ?? 0) + 1); }
      lines.push(`| ${run[0].a.index}–${run.at(-1)!.a.index} | ${(run[0].a.timestamp / 1000).toFixed(2)}–${(run.at(-1)!.a.timestamp / 1000).toFixed(2)} s | ${label[run[0].kind]} ${run.length} | ${[...transitions].map(([k, n]) => `${k} ${n}`).join(', ')} |`);
      start = i;
    }
    lines.push('');
  }
  const worse = changes.filter(c => c.kind === 'worse'), ranking = new Map<string, [number, number]>();
  for (const c of worse) {
    for (const r of reasons(c.a, c.side)) ranking.set(r, [(ranking.get(r)?.[0] ?? 0) + 1, ranking.get(r)?.[1] ?? 0]);
    for (const r of reasons(c.b, c.side)) ranking.set(r, [ranking.get(r)?.[0] ?? 0, (ranking.get(r)?.[1] ?? 0) + 1]);
  }
  const ranked = [...ranking].map(([reason, [x, y]]) => ({ reason, x, y, delta: y - x })).filter(r => r.delta > 0).sort((p, q) => q.delta - p.delta || q.y - p.y);
  lines.push(`## 악화 프레임(${worse.length}개 손·프레임)에서 늘어난 사유`, '');
  if (!ranked.length) lines.push('- 늘어난 사유 없음');
  else lines.push('| 순위 | 사유 | ' + base + ' | ' + other + ' | 증가 |', '| --- | --- | --- | --- | --- |', ...ranked.map((r, i) => `| ${i + 1} | ${r.reason} | ${r.x} | ${r.y} | +${r.delta} |`));
  lines.push('', '사유는 해당 손·프레임에서 셉니다. 한 프레임의 버림·영역 후보 제외는 양손 각각의 악화 프레임에 함께 셀 수 있습니다. 상세 값은 같은 이름의 JSON에 있습니다.', '');
  return lines.join('\n');
}
