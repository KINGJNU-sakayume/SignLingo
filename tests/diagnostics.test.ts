// Round-2 diagnostics: detailed tracking fates, report metrics (a)(b)(c), the hand-fill safeguard and the
// frame trace. Synthetic geometry only (not KSL); published clips are read, never written.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { detection, fixtureClip } from './fixtures';
import { clipMetrics, unionInterval } from '../src/batch/report';
import { buildTrace, traceMarkdown, type FusionRecord } from '../src/batch/trace';
import { fillHands, FILL_GUARD_REPORT, runDisplayPipeline, stabilizeTorso, temporalReconstruct, type FillGuardReport, type FillReport } from '../src/motion/display';
import { pipelineInfo } from '../src/motion/pipeline';
import { Reconstructor } from '../src/motion/reconstruct';
import { importMotion } from '../src/motion/serialization';
import { assignHands, assignHandsDetailed, wristInImage } from '../src/motion/tracking';
import { SIDES, type Detection, type HandDetection, type MotionClip, type Side } from '../src/motion/types';

/** 36 frames at 30 Hz; `edit` changes a frame's detection before reconstruction. */
function clip(edit: (d: Detection, i: number) => void = () => {}, version: '0.2.0' | '0.3.0' = '0.2.0'): MotionClip {
  const c = fixtureClip(), solver = new Reconstructor();
  c.pipeline = pipelineInfo('synthetic-test-fixture-not-sign-language');
  if (version === '0.3.0') c.pipeline.version = '0.3.0';
  c.source = { ...c.source, sampleHz: 30, duration: 1.2 };
  c.frames = Array.from({ length: 36 }, (_, i) => {
    const d = articulatedDetection({ timestamp: i * 1000 / 30, flex: [.2 + i / 120, .3, .2], spread: .1,
      palm: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i / 60)) });
    for (const [wrist, index] of [[15, 0], [16, 1]]) d.hands[index].image[0] = { ...d.body[wrist] };
    edit(d, i);
    return solver.reconstruct(d);
  });
  return c;
}
const shifted = (h: HandDetection, dx: number, label = h.label): HandDetection => ({ ...h, label, image: h.image.map(p => ({ ...p, x: p.x + dx })) });
const dropSide = (d: Detection, side: Side) => { d.hands = d.hands.filter(h => h.label !== (side === 'left' ? 'Left' : 'Right')); };

describe('detailed wrist association', () => {
  it('returns exactly what assignHands returns', () => {
    const frames: Detection[] = [detection(), articulatedDetection(), { ...detection(), hands: [] }];
    const crossing = detection(); crossing.body[15] = { ...crossing.body[15], x: .5 }; crossing.body[16] = { ...crossing.body[16], x: .52 };
    crossing.hands = [shifted(crossing.hands[0], .51 - crossing.hands[0].image[0].x)];
    frames.push(crossing);
    for (const frame of frames) {
      const { assignment, warnings } = assignHandsDetailed(frame);
      expect({ assignment, warnings }).toEqual(assignHands(frame));
    }
  });
  it('explains every hand it does not assign', () => {
    const d = detection();
    const fates = (hands: HandDetection[], body = d.body) => assignHandsDetailed({ ...d, body, hands }).fates;
    expect(fates(d.hands)).toEqual([{ side: 'left' }, { side: 'right' }]);
    expect(fates([d.hands[0], { ...d.hands[1], score: .3 }])[1]).toEqual({ discarded: 'low-score' });
    expect(fates([d.hands[0], { ...d.hands[1], world: d.hands[1].world.slice(0, 20) }])[1]).toEqual({ discarded: 'invalid-landmarks' });
    expect(fates([d.hands[0], shifted(d.hands[1], -.25)])[1]).toEqual({ discarded: 'wrist-too-far' });
    const blind = d.body.map((p, i) => i === 15 || i === 16 ? { ...p, visibility: .1 } : p);
    expect(fates(d.hands, blind)).toEqual([{ discarded: 'no-reliable-wrist' }, { discarded: 'no-reliable-wrist' }]);
    // A second estimate of the left hand with the opposite label makes the left side ambiguous.
    expect(fates([d.hands[0], shifted(d.hands[0], .004, 'Right')])).toEqual([{ discarded: 'ambiguous-crossing' }, { discarded: 'outcompeted' }]);
  });
});

describe('report metrics', () => {
  it('(a) scores a given signing interval and (b) separates off-screen wrists from on-screen failures', () => {
    const c = clip((d, i) => {
      if (i >= 20) dropSide(d, 'left');
      if (i >= 30) d.body[15] = { ...d.body[15], x: .995 }; // wrist leaves the frame
    });
    const all = clipMetrics(c), inside = clipMetrics(c, { interval: { start: .5, end: .9, method: 'manual' } });
    expect(all.hands.left.tracked).toBe(20);
    expect(all.hands.left.offscreen).toBe(all.hands.left.reasons.offscreen);
    expect(all.hands.left.offscreen + all.hands.left.onscreenFailure).toBe(16);
    expect(all.hands.left.offscreen).toBeGreaterThan(0);
    expect(inside.active).toMatchObject({ start: .5, end: .9, method: 'manual', frames: 13 });
    expect(inside.active.hands.left).toMatchObject({ tracked: 5, offscreen: 0, onscreenFailure: 8 });
    expect(inside.active.hands.left.missingRate).toBeCloseTo(8 / 13, 12);
    expect(inside.active.hands.right.missingRate).toBe(0);
    expect(unionInterval({ start: .2, end: 1, method: 'activity' }, { start: .1, end: .8, method: 'full' })).toEqual({ start: .1, end: 1, method: 'activity+full' });
  });
  it('(c) counts hands by origin, the hands tracking discards and why, and hands stored twice', () => {
    const c = clip((d, i) => {
      d.hands = d.hands.map((h, k) => ({ ...h, origin: k === 0 && i < 10 ? 'region' : 'frame' }));
      if (i >= 30) d.hands = [d.hands[0], { ...shifted(d.hands[0], .004, 'Right'), origin: 'region' }];
    }, '0.3.0');
    const d = clipMetrics(c).detections;
    expect(d.stored).toEqual({ frame: 56, region: 16 });
    expect(d.discarded.total).toBe(12);
    expect(d.discarded.reasons).toMatchObject({ 'ambiguous-crossing': 6, outcompeted: 6 });
    expect(d.assigned.frame + d.assigned.region + d.discarded.total).toBe(72);
    expect(d.nearDuplicatePairs).toBe(6);
  });
});

describe('hand-fill safeguard', () => {
  const learner = (c: MotionClip, options = {}) => runDisplayPipeline({ clip: c }, [temporalReconstruct(), stabilizeTorso(), fillHands(options)]);
  const old = { minObservedFraction: 0, hideOffscreen: false };
  it('hides, instead of filling, a hand observed in too few frames of the signing interval', () => {
    const c = clip((d, i) => { if (i > 2) dropSide(d, 'left'); });
    const before = learner(c, old), after = learner(c), guard = after.reports[FILL_GUARD_REPORT] as FillGuardReport;
    expect((before.reports['hand-fill'] as FillReport).left.trail).toBeGreaterThan(20);
    expect((after.reports['hand-fill'] as FillReport).left).toEqual({ lead: 0, gap: 0, trail: 0 });
    expect(guard.sides.left.sufficient).toBe(false);
    expect(guard.sides.left.fraction).toBeLessThan(.15);
    expect(after.frames.filter(f => f.annotation.hands.left.state === 'filled' || f.annotation.hands.left.state === 'held')).toHaveLength(0);
    expect(after.frames[20].annotation.hands.left).toEqual({ state: 'missing', hidden: 'insufficient-evidence' });
    expect(after.frames.slice(0, 3).map(f => f.annotation.hands.left.state)).toEqual(['observed', 'observed', 'observed']);
    expect(after.frames.map(f => f.annotation.hands.right)).toEqual(before.frames.map(f => f.annotation.hands.right));
  });
  it('never fills a frame whose wrist is off-screen and leaves well-observed hands as before', () => {
    const c = clip((d, i) => { if (i >= 12 && i < 18) { dropSide(d, 'left'); if (i >= 15) d.body[15] = { ...d.body[15], x: .995 }; } });
    const before = learner(c, old), after = learner(c);
    expect(wristInImage(c.frames[16], 'left')).toBe(false);
    const states = (display: typeof after) => display.frames.slice(12, 18).map(f => f.annotation.hands.left.state);
    expect(states(before)).toEqual(Array(6).fill('filled'));
    expect(states(after)).toEqual(['filled', 'filled', 'filled', 'missing', 'missing', 'missing']);
    expect((after.reports[FILL_GUARD_REPORT] as FillGuardReport).sides.left.hidden).toEqual({ 'insufficient-evidence': 0, offscreen: 3 });
    expect(learner(clip(), old).frames).toEqual(learner(clip()).frames);
  });
  it('changes published course 1 only where a wrist is off-screen (ksl-meet, 2 frames per hand)', () => {
    const fills: Record<string, string> = {};
    for (const id of ['ksl-thanks', 'ksl-sorry', 'ksl-meet']) {
      const c = importMotion(readFileSync(`public/content/assets/${id}/v1/reference.motion.json`, 'utf8')), snapshot = JSON.stringify(c);
      const before = learner(c, old), after = learner(c), guard = after.reports[FILL_GUARD_REPORT] as FillGuardReport;
      for (const side of SIDES) {
        const b = (before.reports['hand-fill'] as FillReport)[side], a = (after.reports['hand-fill'] as FillReport)[side];
        fills[`${id}.${side}`] = `${b.lead}·${b.gap}·${b.trail} → ${a.lead}·${a.gap}·${a.trail}; hidden ${guard.sides[side].hidden.offscreen}; ${guard.sides[side].fraction.toFixed(3)}`;
        expect(guard.sides[side].hidden['insufficient-evidence']).toBe(0);
      }
      expect(JSON.stringify(c)).toBe(snapshot);
    }
    expect(fills).toEqual({
      'ksl-thanks.left': '38·0·31 → 38·0·31; hidden 0; 0.425', 'ksl-thanks.right': '35·8·29 → 35·8·29; hidden 0; 0.400',
      'ksl-sorry.left': '42·12·26 → 42·12·26; hidden 0; 0.200', 'ksl-sorry.right': '29·14·4 → 29·14·4; hidden 0; 0.520',
      'ksl-meet.left': '5·5·5 → 4·5·4; hidden 2; 0.819', 'ksl-meet.right': '2·4·5 → 0·4·5; hidden 2; 0.843',
    });
  });
});

describe('frame trace', () => {
  // Tool test, not a pipeline claim: in the second run, frames 10–14 store a second, opposite-label estimate of
  // the left hand instead of the right hand (the 0.3.0 failure pattern), so both sides are lost there.
  const base = clip();
  const experiment = clip((d, i) => { if (i >= 10 && i < 15) d.hands = [{ ...d.hands[0], origin: 'frame' }, { ...shifted(d.hands[0], .004, 'Right'), origin: 'region' }]; }, '0.3.0');
  const lost = (t: number) => t >= 333 && t < 500;
  const fusion: FusionRecord[] = experiment.frames.map(f => ({ timestamp: f.timestamp, source: { width: 640, height: 480 }, candidates: { frame: 2, region: lost(f.timestamp) ? 1 : 0 },
    gaps: lost(f.timestamp) ? ['right'] : [], regions: { left: null, right: lost(f.timestamp) ? { x0: 100, y0: 200, size: 120 } : null }, kept: [],
    dropped: lost(f.timestamp) ? [{ side: 'right', label: 'Right', score: .96, reason: 'no-room' }] : [] }));
  const report = buildTrace('synthetic.webm', 'a'.repeat(64), { '0.2.0': base, '0.3.1': experiment }, { '0.3.1': fusion });
  it('records per-frame candidates, boxes, hand fates and states without image data', () => {
    const frame = report.runs['0.3.1'].frames[12];
    expect(frame.candidates).toEqual({ frame: 2, region: 1 });
    expect(frame.gaps).toEqual(['right']);
    expect(frame.regions?.right).toEqual({ x0: 100, y0: 200, size: 120 });
    expect(frame.hands.map(h => h.discarded)).toEqual(['ambiguous-crossing', 'outcompeted']);
    expect(frame.duplicatePairs).toBe(1);
    expect(frame.sides.left.state).not.toBe('tracked');
    expect(report.runs['0.2.0'].frames[12]).toMatchObject({ candidates: { frame: 2, region: 0 }, regions: null, fusionDropped: [] });
    expect(JSON.stringify(report)).not.toMatch(/"(image|world|body|bodyWorld|pixels?|thumbnail|data)"\s*:/);
  });
  it('lists the changed frame ranges and ranks the reasons that grew there', () => {
    const md = traceMarkdown(report);
    expect(md).toMatch(/### 왼손\n\n\| 프레임 \| 시간 \| 구분 \| 바뀐 상태 \|\n\| --- \| --- \| --- \| --- \|\n\| 10–14 \| 0\.33–0\.47 s \| 악화 5 \|/);
    expect(md).toMatch(/\| 1 \| (tracking 버림: ambiguous-crossing|저장: 같은 손 중복|영역 후보 제외: no-room \(오른쪽 영역\)|오른손 상태 원인: unassociated|왼손 상태 원인: ambiguous) \|/);
    for (const reason of ['tracking 버림: ambiguous-crossing', '영역 후보 제외: no-room (오른쪽 영역)', '저장: 같은 손 중복', '왼손 상태 원인: ambiguous']) expect(md).toContain(`| ${reason} | 0 |`);
    expect(traceMarkdown(buildTrace('only.webm', 'b'.repeat(64), { '0.2.0': base }))).toContain('두 버전의 결과가 모두 있어야');
  });
});
