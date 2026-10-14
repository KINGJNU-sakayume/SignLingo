// Display post-processing. Synthetic geometry only; the published clips are read, never written.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { fixtureClip } from './fixtures';
import { Reconstructor } from '../src/motion/reconstruct';
import { reconstructTemporal } from '../src/motion/temporalReconstruction';
import { samplePose } from '../src/motion/player';
import { forwardArm, forwardHand } from '../src/motion/rig';
import { q } from '../src/motion/math';
import { importMotion } from '../src/motion/serialization';
import { seededRng } from '../src/learn/rng';
import { armVisible, displayFor, fillHands, handFocus, hasFilled, PRESETS, runDisplayPipeline, sampleDisplay, stabilizeTorso, type DisplayClip, type DisplayStage, type FillReport, type TorsoReport } from '../src/motion/display';
import { handShape } from '../src/motion/display/fillHands';
import { geodesicMedian } from '../src/motion/display/quaternion';
import { FINGERS, SIDES, type DisplayPose, type MotionClip, type Pose, type Side } from '../src/motion/types';

type Options = { count?: number; jitter?: number; lean?: number; seed?: number; hide?: (i: number) => Side[]; armless?: (i: number) => Side[] };
/** Two-handed synthetic movement. `jitter` adds torso noise (shoulder depth, hip sideways); `lean` a slow sideways lean. */
function signingClip({ count = 60, jitter = 0, lean = 0, seed = 7, hide = () => [], armless = () => [] }: Options = {}): MotionClip {
  const clip = fixtureClip(), solver = new Reconstructor(), rng = seededRng(seed), noise = () => (rng() * 2 - 1) * jitter;
  clip.pipeline.version = '0.2.0';
  clip.frames = Array.from({ length: count }, (_, i) => {
    const phase = i / (count - 1);
    const d = articulatedDetection({ timestamp: i * 33, flex: [.1 + phase * .9, .2 + phase * .6, .15], palm: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phase * .8) });
    for (const [wrist, hand] of [[15, 0], [16, 1]]) {
      d.bodyWorld[wrist].y -= phase * .2; d.bodyWorld[wrist].z -= Math.sin(phase * Math.PI) * .12; d.body[wrist].y -= phase * .1;
      d.hands[hand].image[0] = { ...d.body[wrist] };
    }
    d.bodyWorld[11].z += noise(); d.bodyWorld[12].z += noise();
    for (const hip of [23, 24]) d.bodyWorld[hip].x += lean * (phase - .5) + noise();
    for (const side of armless(i)) for (const w of [side === 'left' ? 15 : 16]) { d.body[w].visibility = 0; d.bodyWorld[w].visibility = 0; }
    const hidden = hide(i);
    d.hands = d.hands.filter(h => !hidden.includes(h.label === 'Left' ? 'left' : 'right'));
    return solver.reconstruct(d);
  });
  clip.source.duration = (count - 1) * .033;
  return clip;
}
const angle = (a: Quaternion, b: Quaternion) => a.angleTo(b) * 180 / Math.PI;
function torsoVariance(poses: Pose[]) {
  const qs = poses.filter(p => p.quality.body > 0).map(p => q(p.rotations.torso));
  const median = geodesicMedian(qs);
  return qs.reduce((sum, x) => sum + angle(x, median) ** 2, 0) / qs.length;
}
/** Mean squared frame-to-frame torso rotation (deg²): the shake a viewer sees. */
function torsoShake(poses: Pose[]) {
  const steps = poses.slice(1).flatMap((pose, i) => pose.quality.body > 0 && poses[i].quality.body > 0 ? [angle(q(pose.rotations.torso), q(poses[i].rotations.torso)) ** 2] : []);
  return steps.reduce((a, b) => a + b, 0) / steps.length;
}
const roll = (pose: Pose) => { const up = new Vector3(0, 1, 0).applyQuaternion(q(pose.rotations.torso)); return Math.atan2(-up.x, up.y) * 180 / Math.PI; };
/** Every visible hand point and palm of the display equals the reconstruction (within the reach residual). */
function expectHandsPreserved(clip: MotionClip, display: DisplayClip, skipFilled = true) {
  let checked = 0;
  display.frames.forEach((frame, i) => {
    for (const side of SIDES) {
      const original = clip.frames[i].pose;
      if (!armVisible(original, side) || (skipFilled && frame.annotation.hands[side].state === 'filled')) continue;
      const before = forwardHand(original, side), after = forwardHand(frame.pose, side), residual = frame.annotation.torso?.wristResidual[side] ?? 0;
      for (const [k, point] of before.points.entries()) expect(point.distanceTo(after.points[k])).toBeLessThanOrEqual(residual + 1e-6);
      expect(before.palm.angleTo(after.palm)).toBeLessThan(1e-6);
      checked++;
    }
  });
  expect(checked).toBeGreaterThan(0);
}

describe('torso stabilization', () => {
  it('holds a jittering torso still while every hand keeps its reconstructed world position', () => {
    const clip = signingClip({ jitter: .02 });
    const display = runDisplayPipeline({ clip }, [stabilizeTorso()]), report = display.reports['torso-stabilize'] as TorsoReport;
    expect(report.mode).toBe('fixed');
    const before = torsoVariance(clip.frames.map(f => f.pose)), after = torsoVariance(display.frames.map(f => f.pose));
    expect(before).toBeGreaterThan(1);
    expect(after).toBeLessThan(before * .1);
    expectHandsPreserved(clip, display);
    // Only the elbows absorb the moved shoulders; the fixed-length arm reaches every wrist here.
    expect(report.maxWristResidual).toBeLessThan(1e-9);
    expect(report.maxElbowShift).toBeGreaterThan(0);
    for (const [i, frame] of display.frames.entries()) {
      // Children of the torso keep their world orientation (upper' = q_s⁻¹·q_o·upper for the head).
      const head = (pose: Pose) => q(pose.rotations.torso).multiply(q(pose.rotations.head));
      expect(head(clip.frames[i].pose).angleTo(head(frame.pose))).toBeLessThan(1e-6);
      expect(frame.annotation.torso?.mode).toBe('fixed');
    }
  });
  it('removes high-frequency jitter from a real lean without delaying it', () => {
    const clean = signingClip({ lean: .3 }), noisy = signingClip({ lean: .3, jitter: .02 });
    const display = runDisplayPipeline({ clip: noisy }, [stabilizeTorso()]), report = display.reports['torso-stabilize'] as TorsoReport;
    expect(report.mode).toBe('smoothed');
    const middle = clean.frames.map((_, i) => i).slice(15, 45);
    const rms = (poses: Pose[]) => Math.sqrt(middle.reduce((sum, i) => sum + angle(q(poses[i].rotations.torso), q(clean.frames[i].pose.rotations.torso)) ** 2, 0) / middle.length);
    expect(rms(display.frames.map(f => f.pose))).toBeLessThan(rms(noisy.frames.map(f => f.pose)) * .6);
    // A causal 1 Hz filter would trail this ~13°/s lean by ~2°; the two-sided filter has no lag.
    const bias = middle.reduce((sum, i) => sum + roll(display.frames[i].pose) - roll(clean.frames[i].pose), 0) / middle.length;
    expect(Math.abs(bias)).toBeLessThan(.7);
    expect(Math.abs(roll(display.frames[50].pose) - roll(display.frames[10].pose))).toBeGreaterThan(10);
    expectHandsPreserved(noisy, display);
  });
});

describe('hand filling', () => {
  // Left hand hidden before its first appearance, in a gap (first held ≤200 ms, then missing) and at the end.
  const hide = (i: number): Side[] => i < 6 || (i >= 20 && i < 28) || i >= 50 ? ['left'] : [];
  const clip = signingClip({ hide, armless: i => i === 2 ? ['left'] : [] });
  const input = runDisplayPipeline({ clip }, []), display = runDisplayPipeline({ clip }, [fillHands()]);
  const fingers = (pose: DisplayPose) => FINGERS.flatMap(f => [0, 1, 2].map(j => q(pose.rotations[`left.${f}.${j}`])));
  const same = (a: Quaternion[], b: Quaternion[]) => a.forEach((x, k) => expect(x.angleTo(b[k])).toBeLessThan(1e-6));

  it('starts from held and missing states and leaves observed frames untouched', () => {
    expect(input.frames[21].annotation.hands.left.state).toBe('held');
    expect(input.frames[27].annotation.hands.left.state).toBe('missing');
    const filled = fillHands().run(input, { clip });
    for (const [i, frame] of filled.frames.entries()) if (input.frames[i].annotation.hands.left.state === 'observed') expect(frame).toBe(input.frames[i]);
    expect(display.frames.every(f => f.annotation.hands.right.state === 'observed')).toBe(true);
  });
  it('fills before the first appearance with the first observed handshape', () => {
    for (const i of [0, 1, 3, 4, 5]) {
      expect(display.frames[i].annotation.hands.left).toEqual({ state: 'filled', fill: 'lead', anchors: [6, 6] });
      same(fingers(display.frames[i].pose), fingers(input.frames[6].pose));
      expect(handShape(display.frames[i].pose, 'left').relative.angleTo(handShape(input.frames[6].pose, 'left').relative)).toBeLessThan(1e-6);
      // Only rotations change: the wrist stays where the arm reconstruction put it.
      expect(forwardArm(display.frames[i].pose, 'left').wrist.distanceTo(forwardArm(input.frames[i].pose, 'left').wrist)).toBeLessThan(1e-9);
    }
    // A hidden arm is never given a hand.
    expect(display.frames[2].annotation.hands.left.state).toBe('missing');
  });
  it('bridges a gap with a time-proportional slerp of the surrounding shapes, held frames included', () => {
    for (let i = 20; i < 28; i++) expect(display.frames[i].annotation.hands.left).toEqual({ state: 'filled', fill: 'gap', anchors: [19, 28] });
    const t = (display.frames[24].timestamp - display.frames[19].timestamp) / (display.frames[28].timestamp - display.frames[19].timestamp);
    const a = fingers(input.frames[19].pose), b = fingers(input.frames[28].pose);
    same(fingers(display.frames[24].pose), a.map((x, k) => x.clone().slerp(b[k], t)));
    const ra = handShape(input.frames[19].pose, 'left').relative, rb = handShape(input.frames[28].pose, 'left').relative;
    expect(handShape(display.frames[24].pose, 'left').relative.angleTo(ra.clone().slerp(rb, t))).toBeLessThan(1e-6);
  });
  it('holds the last observed handshape after the last appearance and reports every fill', () => {
    for (let i = 50; i < 60; i++) { expect(display.frames[i].annotation.hands.left.fill).toBe('trail'); same(fingers(display.frames[i].pose), fingers(input.frames[49].pose)); }
    expect(display.reports['hand-fill']).toEqual({ left: { lead: 5, gap: 8, trail: 10 }, right: { lead: 0, gap: 0, trail: 0 } } satisfies FillReport);
    expect(hasFilled(display)).toBe(true); expect(hasFilled(input)).toBe(false);
  });
  it('plays filled frames smoothly instead of stepping between them', () => {
    const between = (display.frames[23].timestamp + display.frames[24].timestamp) / 2000;
    const pose = sampleDisplay(display, between)!;
    expect(pose.hands?.left).toBe('filled');
    const key = 'left.index.0', a = q(display.frames[23].pose.rotations[key]), b = q(display.frames[24].pose.rotations[key]);
    expect(q(pose.rotations[key]).angleTo(a.clone().slerp(b, .5))).toBeLessThan(1e-6);
  });
  it('frames the observed signing space, not filled lead-in hands', () => {
    const focus = handFocus([display])!, observed = display.frames.flatMap(f => f.annotation.hands.left.state === 'observed' ? [forwardHand(f.pose, 'left').wrist.y] : []);
    expect(focus.center[1]).toBeGreaterThan(Math.min(...observed) - .1); expect(focus.center[1]).toBeLessThan(Math.max(...observed) + .1);
  });
});

describe('display pipeline', () => {
  it('never modifies the stored clip', () => {
    const clip = signingClip({ jitter: .02, hide: i => i < 10 ? ['right'] : [] });
    const frozen = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; };
    const before = JSON.stringify(clip);
    expect(() => runDisplayPipeline({ clip: frozen(clip) }, PRESETS.learner())).not.toThrow();
    expect(JSON.stringify(clip)).toBe(before);
  });
  it('composes stages from a list, so a future constraint stage can sit between them', () => {
    const clip = signingClip({ jitter: .02, hide: i => i < 10 ? ['right'] : [] });
    const constraint: DisplayStage = { id: 'constraint-check', run: display => ({ ...display, reports: { ...display.reports, 'constraint-check': { after: display.stages } },
      frames: display.frames.map(f => ({ ...f, annotation: { ...f.annotation, stages: [...f.annotation.stages, 'constraint-check'] } })) }) };
    const display = runDisplayPipeline({ clip }, [stabilizeTorso(), constraint, fillHands()]);
    expect(display.stages).toEqual(['torso-stabilize', 'constraint-check', 'hand-fill']);
    expect(display.reports['constraint-check']).toEqual({ after: ['torso-stabilize'] });
    expect(display.frames[3].annotation.stages).toEqual(['torso-stabilize', 'constraint-check', 'hand-fill']);
    expect(display.frames[30].annotation.stages).toEqual(['torso-stabilize', 'constraint-check']);
  });
  it('samples exactly like samplePose when no stage runs, with or without temporal reconstruction', () => {
    const clip = signingClip({ hide: i => (i >= 20 && i < 24) || i > 55 ? ['left'] : [] }), temporal = reconstructTemporal(clip);
    for (const extra of [undefined, temporal]) {
      const display = runDisplayPipeline({ clip, temporal: extra }, []);
      for (let t = 0; t <= 2; t += .0173) {
        const { hands, ...pose } = sampleDisplay(display, t)!;
        expect(pose).toEqual(samplePose(clip, t, extra));
        expect(hands).toBeDefined();
      }
    }
  });
});

describe('published course 1 (read-only)', () => {
  const clips = Object.fromEntries(['ksl-thanks', 'ksl-sorry', 'ksl-meet'].map(id => [id, importMotion(readFileSync(`public/content/assets/${id}/v1/reference.motion.json`, 'utf8'))]));
  it('steadies each torso while keeping hands, palms and two-hand contact as reconstructed', () => {
    const modes: Record<string, string> = {};
    for (const [id, clip] of Object.entries(clips)) {
      const display = displayFor(clip, 'learner'), report = display.reports['torso-stabilize'] as TorsoReport;
      modes[id] = report.mode;
      // Fixed arm reach clamps a few wrists by at most ~1.5 mm; nothing else moves a hand.
      expect(report.maxWristResidual).toBeLessThan(.002);
      expectHandsPreserved(clip, display);
      const before = clip.frames.map(f => f.pose), after = display.frames.map(f => f.pose);
      if (report.mode === 'fixed') expect(torsoVariance(after)).toBeLessThan(1e-6);
      expect(torsoShake(after)).toBeLessThan(torsoShake(before) * .1);
      // Fingertip-to-fingertip distance (contact in ksl-meet) wherever both hands are observed.
      display.frames.forEach((frame, i) => {
        if (!SIDES.every(side => frame.annotation.hands[side].state === 'observed')) return;
        const gap = (pose: Pose) => forwardHand(pose, 'left').points[8].distanceTo(forwardHand(pose, 'right').points[8]);
        expect(Math.abs(gap(frame.pose) - gap(clip.frames[i].pose))).toBeLessThan(.002);
      });
      expect(hasFilled(display)).toBe(true);
    }
    expect(modes).toEqual({ 'ksl-thanks': 'fixed', 'ksl-sorry': 'smoothed', 'ksl-meet': 'fixed' });
  });
});
