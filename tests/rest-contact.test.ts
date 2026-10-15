// Course-1 revision-2 review findings: rest before/after the sign, hands that touch instead of overlapping, the
// signing interval, and the two revision-2 display regressions. Published clips are read, never written.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { importMotion } from '../src/motion/serialization';
import { armVisible, CONTACT_STAGE, displayFor, FILL_GUARD_REPORT, learnerStages, REST_STAGE, runDisplayPipeline, sampleDisplay, type FillGuardReport, type RestReport } from '../src/motion/display';
import { deepestPenetration, handsOf, leftward, separateHands, TOUCH_METERS } from '../src/motion/handContact';
import { signingInterval } from '../src/motion/signing';
import { applyConstraints, parseConstraints, sourceClip } from '../src/motion/constraints';
import { handState, type HandState } from '../src/motion/constraints/points';
import { presetRotations } from '../src/motion/constraints/presets';
import { SIDES, type MotionClip, type Side } from '../src/motion/types';

const IDS = ['ksl-thanks', 'ksl-sorry', 'ksl-meet'] as const;
const load = (id: string, revision: 1 | 2): MotionClip => importMotion(readFileSync(`public/content/assets/${id}/v${revision}/reference.motion.json`, 'utf8'));
const v1 = Object.fromEntries(IDS.map(id => [id, load(id, 1)]));
const v2 = Object.fromEntries(IDS.map(id => [id, load(id, 2)]));
const raisedRange = (clip: MotionClip, side: Side) => { const r = signingInterval(clip).sides[side].raised.flatMap((x, i) => x ? [i] : []); return [r[0], r.at(-1)!]; };

describe('signing interval (hands raised from rest)', () => {
  it('excludes the rest before and after each published sign, where the motion heuristic took the whole clip', () => {
    const found = Object.fromEntries(IDS.map(id => { const s = signingInterval(v1[id]); return [id, [s.method, +s.start.toFixed(2), +s.end.toFixed(2)]]; }));
    expect(found).toEqual({ 'ksl-thanks': ['raised-hands', 1.27, 3], 'ksl-sorry': ['raised-hands', 1.2, 2.63], 'ksl-meet': ['raised-hands', 1.37, 3.4] });
    // The same clips are solved from their source: revision 2 measures the same interval.
    for (const id of IDS) expect(signingInterval(sourceClip(v2[id])).start).toBe(signingInterval(v1[id]).start);
  });
  it('keeps whole-sign constraints off the resting hands (solver v2)', async () => {
    const set = parseConstraints(readFileSync('docs/constraints/ksl-thanks.constraints.json', 'utf8'));
    const { clip: corrected } = await applyConstraints(v1['ksl-thanks'], set);
    expect(corrected.constraints!.solver).toBe('signlingo-constraint-solver-v2');
    const changed = corrected.frames.flatMap((f, i) => f.constraint ? [i] : []);
    expect([changed[0], changed.at(-1)]).toEqual([39, 89]); // span 38–90, blended in and out inside it
    // Revision 2 (solver v1) changed 118 of 120 frames, the rest included.
    expect(v2['ksl-thanks'].frames.filter(f => f.constraint).length).toBe(118);
  });
  it('treats the hand of a one-handed sign that stays down as passive', () => {
    const report = displayFor(v2['ksl-sorry'], 'learner').reports[REST_STAGE] as RestReport;
    expect(report.left.passive).toBe(true); expect(report.right.passive).toBe(false);
    for (const id of ['ksl-thanks', 'ksl-meet']) expect(SIDES.map(side => (displayFor(v2[id], 'learner').reports[REST_STAGE] as RestReport)[side].passive)).toEqual([false, false]);
  });
});

describe('rest pose on learner screens', () => {
  it('shows both arms and relaxed hands before and after every published sign: no handshape to guess from', () => {
    for (const id of IDS) for (const clip of [v1[id], v2[id]]) {
      const display = displayFor(clip, 'learner');
      for (const side of SIDES) {
        const [first, last] = raisedRange(clip, side);
        display.frames.forEach((frame, i) => {
          if (frame.pose.quality.body <= 0 || (i >= first && i <= last)) return;
          const shown = armVisible(frame.pose, side) || frame.annotation.arms?.[side] === 'rest';
          expect(shown, `${id} frame ${i} ${side} arm`).toBe(true);
          // Before the hand rises and after it is down again, only the rest hand is drawn (blend frames aside).
          if (Math.abs(i - first) > 3 && Math.abs(i - last) > 3) expect(frame.annotation.hands[side].state, `${id} frame ${i} ${side}`).toBe('rest');
        });
      }
      const opening = sampleDisplay(display, 0)!;
      expect(opening.hands).toEqual({ left: 'rest', right: 'rest' });
    }
  });
  it('fills a lost arm only around the rest, moving into the first tracked pose without a jump', () => {
    const display = displayFor(v2['ksl-meet'], 'learner');
    const rest = display.frames.flatMap((f, i) => f.annotation.arms?.left === 'rest' ? [i] : []);
    expect(rest.length).toBeGreaterThan(30);
    const wrist = (i: number) => handState(display.frames[i].pose, 'left').wrist;
    // Into and out of a rest arm, consecutive frames never jump more than 4 cm (≈1.2 m/s at 30 Hz).
    for (let i = 1; i < display.frames.length; i++) {
      if (!rest.includes(i) && !rest.includes(i - 1)) continue;
      expect(wrist(i).distanceTo(wrist(i - 1)), `frame ${i}`).toBeLessThan(.04);
    }
  });
  it('never changes an observed hand inside the sign', () => {
    for (const id of IDS) {
      const clip = v1[id], before = runDisplayPipeline({ clip }, learnerStages(undefined, { presentation: false })), after = displayFor(clip, 'learner');
      for (const side of SIDES) {
        const [first, last] = raisedRange(clip, side);
        const keys = Object.keys(before.frames[0].pose.rotations).filter(key => key.startsWith(`${side}.`));
        before.frames.forEach((frame, i) => {
          if (i < first || i > last || frame.annotation.hands[side].state !== 'observed' || after.frames[i].annotation.contact) return;
          if (keys.every(key => after.frames[i].pose.rotations[key].every((x, k) => Math.abs(x - frame.pose.rotations[key][k]) < 1e-12))) return;
          // A rest edit inside the sign only happens to a sub-100 ms detection blip while the hand rests.
          expect(after.frames[i].annotation.hands[side].state, `${id} frame ${i} ${side}`).toBe('rest');
        });
      }
    }
  });
});

describe('hands touch instead of passing into each other', () => {
  /** Two index hands, palms facing, fingers up, wrists `gap` meters apart on the lateral axis. */
  const facing = (gap: number) => {
    const palm = (normal: number) => { const y = new Vector3(0, 1, 0), z = new Vector3(normal, 0, 0); return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(y.clone().cross(z), y, z)); };
    const hand = (side: Side): HandState => ({ wrist: new Vector3(side === 'left' ? gap / 2 : -gap / 2, 1.1, .3), palm: palm(side === 'left' ? -1 : 1), fingers: presetRotations('index', side) });
    return { left: hand('left'), right: hand('right') };
  };
  it('separates overlapping hands by the smallest move, until their surfaces just touch', () => {
    const hands = facing(.02), before = deepestPenetration(hands.left, hands.right, new Vector3(1, 0, 0));
    expect(before?.depth ?? 0).toBeGreaterThan(.01);
    const result = separateHands(hands.left, hands.right, new Vector3(1, 0, 0));
    expect(result.after).toBeLessThanOrEqual(TOUCH_METERS);
    expect(result.shift.left.length()).toBeCloseTo(result.shift.right.length(), 9);
    // Touching, not apart: moving back by 2 mm overlaps again.
    const back = { left: { ...hands.left, wrist: hands.left.wrist.clone().addScaledVector(result.direction, -.002) }, right: hands.right };
    expect(deepestPenetration(back.left, back.right, new Vector3(1, 0, 0))?.depth ?? 0).toBeGreaterThan(TOUCH_METERS);
    // Along a given axis only (mirror-symmetric hands stay symmetric).
    const axis = new Vector3(1, 0, 0), again = facing(.02);
    again.right.wrist.z += .01;
    expect(Math.abs(separateHands(again.left, again.right, axis, .5, axis).direction.dot(axis))).toBeCloseTo(1, 9);
  });
  it('leaves no overlap in any published learner display, and only moves hands that overlapped', () => {
    for (const id of IDS) for (const clip of [v1[id], v2[id]]) {
      const display = displayFor(clip, 'learner');
      display.frames.forEach((frame, i) => {
        if (!SIDES.every(side => frame.annotation.hands[side].state !== 'missing' && (armVisible(frame.pose, side) || frame.annotation.arms?.[side]))) return;
        const hands = handsOf(frame.pose);
        expect(deepestPenetration(hands.left, hands.right, leftward(frame.pose))?.depth ?? 0, `${id} frame ${i}`).toBeLessThanOrEqual(.001);
      });
    }
    // Revision 2 of ksl-meet pushed both wrists 4 cm into each other; now they stop at the first touching surfaces.
    const meet = displayFor(v2['ksl-meet'], 'learner');
    const moved = meet.frames.filter(f => f.annotation.contact);
    expect(moved.length).toBeGreaterThan(15);
    expect(Math.max(...moved.map(f => f.annotation.contact!.before))).toBeGreaterThan(.035);
    expect(Math.max(...moved.map(f => f.annotation.contact!.after))).toBeLessThanOrEqual(.001);
    expect(displayFor(v2['ksl-thanks'], 'learner').frames.some(f => f.annotation.stages.includes(CONTACT_STAGE))).toBe(false);
  });
});

describe('revision-2 display regressions', () => {
  it('counts constraint-adjusted observations as evidence for the fill safeguard', () => {
    for (const id of IDS) {
      const guard = (clip: MotionClip) => (displayFor(clip, 'learner').reports[FILL_GUARD_REPORT] as FillGuardReport).sides;
      for (const side of SIDES) expect(guard(v2[id])[side].fraction, `${id} ${side}`).toBeCloseTo(guard(v1[id])[side].fraction, 9);
    }
  });
  it('does not mark a hand as corrected when only floating-point round-off differs', () => {
    // Revision 2 of ksl-sorry lists left-hand joints whose rotations differ by ~1e-16 and carry no evidence.
    const clip = v2['ksl-sorry'];
    const roundOff = clip.frames.filter(f => f.constraint && !f.constraint.evidence.left && f.constraint.joints.some(j => j.startsWith('left.')));
    expect(roundOff.length).toBeGreaterThan(0);
    const display = runDisplayPipeline({ clip }, learnerStages(undefined, { presentation: false }));
    for (const frame of display.frames) if (frame.annotation.hands.left.state === 'constrained') expect(frame.annotation.hands.left.evidence).toBeDefined();
  });
});
