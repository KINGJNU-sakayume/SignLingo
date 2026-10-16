// Constraint correction on synthetic geometry. Public course 1 clips are read, never written.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Quaternion, Vector3 } from 'three';
import { practiceClip } from './practice-fixtures';
import { fixtureClip } from './fixtures';
import { LENGTHS, q } from '../src/motion/math';
import { forwardArm, forwardHand } from '../src/motion/rig';
import { exportMotion, importMotion } from '../src/motion/serialization';
import { reconstructClip } from '../src/motion/comparison';
import { editedPose } from '../src/motion/player';
import { reconstructFingers } from '../src/motion/hand';
import { FINGERS, SIDES, type MotionClip, type Side } from '../src/motion/types';
import {
  applyConstraints, blendWeight, constraintHash, handPoint, handState, HANDSHAPES, parseConstraints, PRESET_IDS, presetRotations,
  resolveSpan, solveStored, sourceClip, verifyConstraintRecord, type ConstraintInput, type ConstraintSet,
} from '../src/motion/constraints';
import { fingerChain } from '../src/motion/constraints/points';
import { constrain, displayFor, fillHands, hasConstrained, learnerStages, PRESETS, runDisplayPipeline, sampleDisplay } from '../src/motion/display';

const doc = (constraints: ConstraintInput['constraints'], extra: Partial<ConstraintInput> = {}): ConstraintSet =>
  parseConstraints({ format: 'signlingo.constraints', version: 1, ...extra, constraints });
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
/** 31 frames over 2 s; the left wrist rises much more than the right (asymmetric heights). */
const clip = () => { const c = practiceClip(); c.pipeline.version = '0.2.0'; return c; };
const wrist = (pose: MotionClip['frames'][number]['pose'], side: Side) => forwardArm(pose, side).wrist;

describe('constraint document', () => {
  it('fills defaults, rejects unknown fields, missing notes, duplicate ids and unusable targets', () => {
    const set = doc([{ id: 'height', kind: 'sameHeight', span: { phase: 'end' }, points: ['left.wrist', 'right.wrist'], note: '양손 높이를 맞춘다' }]);
    expect(set.constraints[0]).toMatchObject({ blendMs: 100, strength: 1, toleranceCm: 1, move: 'both' });
    const bad = (constraints: unknown[]) => () => parseConstraints({ format: 'signlingo.constraints', version: 1, constraints });
    expect(bad([{ id: 'a', kind: 'sameHeight', span: { phase: 'end' }, points: ['left.wrist', 'right.wrist'], note: '메모', color: 'red' }])).toThrow('constraints[0]');
    expect(bad([{ id: 'a', kind: 'sameHeight', span: { phase: 'end' }, points: ['left.wrist', 'right.wrist'] }])).toThrow('note');
    expect(bad([{ id: 'a', kind: 'handshape', span: { phase: 'end' }, hand: 'left', preset: 'fist', note: '주먹' }, { id: 'a', kind: 'handshape', span: { phase: 'end' }, hand: 'right', preset: 'fist', note: '주먹' }])).toThrow('같은 id');
    expect(bad([{ id: 'a', kind: 'handshape', span: { phase: 'end' }, hand: 'left', preset: 'one-finger', note: '검지' }])).toThrow('preset');
    expect(bad([{ id: 'a', kind: 'contact', span: { phase: 'end' }, a: 'left.index.tip', b: 'left.thumb.tip', note: '같은 손' }])).toThrow('같은 손');
    expect(bad([{ id: 'a', kind: 'sameHeight', span: { phase: 'end' }, points: ['head.chin', 'body.chest'], note: '몸 점만' }])).toThrow('손 점');
    expect(bad([{ id: 'a', kind: 'wristOffset', span: { frames: [3, 1] }, hand: 'left', degrees: [0, 0, 0], note: '역순' }])).toThrow('순서');
    expect(bad([{ id: 'a', kind: 'wristOffset', span: { frames: [1, 3] }, hand: 'left', degrees: [60, 0, 0], note: '범위 밖' }])).toThrow();
    expect(() => parseConstraints('{not json')).toThrow('읽지 못했습니다');
  });
  it('hashes the parsed document canonically: key order and written defaults do not matter', async () => {
    const a = doc([{ id: 'x', kind: 'handshape', span: { phase: 'end' }, hand: 'left', preset: 'fist', note: '주먹' }]);
    const b = parseConstraints({ constraints: [{ note: '주먹', preset: 'fist', hand: 'left', span: { phase: 'end' }, kind: 'handshape', id: 'x', blendMs: 100 }], version: 1, format: 'signlingo.constraints' });
    expect(await constraintHash(a)).toBe(await constraintHash(b));
    expect(await constraintHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('spans and blending', () => {
  const times = Array.from({ length: 11 }, (_, i) => i * 100), interval = { start: .2, end: .8, method: 'activity' };
  it('resolves frame, time and relative spans', () => {
    expect(resolveSpan({ frames: [2, 4] }, times, interval)).toMatchObject({ startMs: 200, endMs: 400, firstFrame: 2, lastFrame: 4 });
    expect(resolveSpan({ ms: [250, 520] }, times, interval)).toMatchObject({ firstFrame: 3, lastFrame: 5 });
    expect(resolveSpan({ phase: 'end' }, times, interval)).toMatchObject({ startMs: expect.closeTo(600), endMs: expect.closeTo(800), firstFrame: 6, lastFrame: 8, basis: 'active-interval' });
    expect(resolveSpan({ fraction: [0, .5] }, times, interval)).toMatchObject({ startMs: expect.closeTo(200), endMs: expect.closeTo(500) });
    expect(resolveSpan({ frames: [20, 30] }, times, interval)).toBeNull();
  });
  it('blends inside the span only: zero at and beyond the boundary, one in the core', () => {
    const span = resolveSpan({ frames: [2, 8] }, times, interval)!;
    expect(blendWeight(100, span, 100)).toBe(0); expect(blendWeight(200, span, 100)).toBe(0);
    expect(blendWeight(250, span, 100)).toBeCloseTo(.5); expect(blendWeight(300, span, 100)).toBe(1);
    expect(blendWeight(500, span, 0)).toBe(1); expect(blendWeight(900, span, 0)).toBe(0);
  });
});

describe('solver on stored frames', () => {
  const height = doc([{ id: 'height', kind: 'sameHeight', span: { frames: [10, 30] }, blendMs: 150, points: ['left.wrist', 'right.wrist'], toleranceCm: 1, note: '양손 높이' }]);
  it('brings both wrists within the height tolerance in the core of the span', () => {
    const source = clip(), solution = solveStored(source, height);
    const before = source.frames.map(f => Math.abs(wrist(f.pose, 'left').y - wrist(f.pose, 'right').y));
    expect(Math.max(...before.slice(20))).toBeGreaterThan(.05);
    const result = solution.constraints[0];
    let core = 0;
    result.rows.forEach((row, i) => {
      if (!row?.core) return;
      core++;
      const pose = solution.poses[i];
      expect(Math.abs(wrist(pose, 'left').y - wrist(pose, 'right').y)).toBeLessThanOrEqual(.01 + 1e-6);
      expect(row.after).toBeLessThanOrEqual(.01 + 1e-6);
    });
    expect(core).toBeGreaterThan(10);
    expect(result.summary.satisfiedAfter).toBe(result.summary.measuredCoreFrames);
    expect(result.summary.after.max!).toBeLessThan(result.summary.before.max!);
  });
  it('keeps fixed arm lengths and shoulders, and leaves every frame outside the span untouched', () => {
    const source = clip(), solution = solveStored(source, height);
    solution.poses.forEach((pose, i) => {
      for (const side of SIDES) {
        const after = forwardArm(pose, side), before = forwardArm(source.frames[i].pose, side);
        expect(after.elbow.distanceTo(after.shoulder)).toBeCloseTo(LENGTHS.upper, 9);
        expect(after.wrist.distanceTo(after.elbow)).toBeCloseTo(LENGTHS.lower, 9);
        expect(after.shoulder.distanceTo(before.shoulder)).toBeLessThan(1e-12);
      }
      if (i <= 10) expect(pose.rotations).toEqual(source.frames[i].pose.rotations);
    });
    expect(solution.changes.every(c => c.index > 10 && c.index <= 30)).toBe(true);
  });
  it('moves the hands so the named points get closer (contact)', () => {
    const set = doc([{ id: 'touch', kind: 'contact', span: { frames: [5, 25] }, a: 'left.index.tip', b: 'right.index.tip', maxShiftCm: 40, note: '검지 끝이 닿는다' }]);
    const source = clip(), solution = solveStored(source, set), rows = solution.constraints[0].rows;
    const distance = (pose: MotionClip['frames'][number]['pose']) => handPoint(handState(pose, 'left'), 'left', 'index.tip').distanceTo(handPoint(handState(pose, 'right'), 'right', 'index.tip'));
    for (let i = 5; i <= 25; i++) {
      expect(distance(solution.poses[i])).toBeLessThanOrEqual(distance(source.frames[i].pose) + 1e-9);
      if (rows[i]?.core && rows[i]!.status === 'ok') expect(distance(solution.poses[i])).toBeLessThanOrEqual(.01 + 1e-6);
    }
    expect(solution.constraints[0].summary.after.max!).toBeLessThan(solution.constraints[0].summary.before.max! * .2);
    // The default 15 cm cap never lets a misplaced span teleport a hand; capped frames are reported.
    const capped = solveStored(source, doc([{ id: 'touch', kind: 'contact', span: { frames: [5, 25] }, a: 'left.index.tip', b: 'right.index.tip', note: '검지 끝이 닿는다' }]));
    for (let i = 5; i <= 25; i++) for (const side of SIDES) expect(wrist(capped.poses[i], side).distanceTo(wrist(source.frames[i].pose, side))).toBeLessThanOrEqual(.15 + 1e-9);
    expect(capped.constraints[0].summary.cappedFrames).toBeGreaterThan(0);
  });
  it('never moves a hand that has no observation at that frame, even when its arm is shown', () => {
    const source = clip();
    for (const frame of source.frames.slice(10, 15)) { frame.pose.quality.rightState = 'missing'; frame.pose.quality.right = 0; }
    const solution = solveStored(source, height);
    for (let i = 11; i < 15; i++) {
      expect(solution.poses[i].rotations['right.upper']).toEqual(source.frames[i].pose.rotations['right.upper']);
      expect(solution.constraints[0].rows[i]!.status).toBe('unavailable');
    }
  });
  it('records observed and constrained evidence; a missing hand takes the preset and is marked constrained', () => {
    const source = clip();
    for (const frame of source.frames.slice(0, 8)) { frame.pose.quality.leftState = 'missing'; frame.pose.quality.left = 0; }
    const set = doc([{ id: 'fist', kind: 'handshape', span: { frames: [0, 15] }, blendMs: 0, hand: 'left', preset: 'fist', note: '왼손 주먹' }]);
    const solution = solveStored(source, set), target = presetRotations('fist', 'left');
    for (const change of solution.changes) {
      expect(change.evidence.left).toBe(change.index < 8 ? 'constrained' : 'observed');
      expect(change.fingers.left).toBe(true);
      expect(change.evidence.right).toBeUndefined();
      for (const [key, r] of Object.entries(target)) expect(q(solution.poses[change.index].rotations[key]).angleTo(r)).toBeLessThan(1e-6);
    }
    expect(solution.changes.map(c => c.index)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });
  it('turns a palm to face the requested direction within tolerance, respecting the wrist limit', () => {
    const set = doc([{ id: 'down', kind: 'palmFacing', span: { frames: [0, 30] }, blendMs: 0, hand: 'both', facing: 'down', toleranceDeg: 10, note: '손바닥이 아래' }]);
    const source = clip(), solution = solveStored(source, set), result = solution.constraints[0];
    for (const [i, row] of result.rows.entries()) {
      if (!row || row.status !== 'ok') continue;
      for (const side of SIDES) {
        const normal = new Vector3(0, 0, 1).applyQuaternion(forwardArm(solution.poses[i], side).palm);
        expect(normal.angleTo(new Vector3(0, -1, 0).applyQuaternion(q(solution.poses[i].rotations.torso))) * 180 / Math.PI).toBeLessThanOrEqual(10.6);
      }
    }
    expect(result.summary.satisfiedAfter + result.summary.limitedFrames).toBeGreaterThanOrEqual(result.summary.coreFrames - result.summary.unavailableFrames);
  });
  it('mirrors the hands across the body midline (lateral symmetry) and applies wrist offsets like Motion Lab edits', () => {
    const source = clip();
    // Palms in line with the forearm, so mirrored palms stay inside the wrist joint limit.
    for (const frame of source.frames) for (const side of SIDES) frame.pose.rotations[`${side}.wrist`] = [0, 0, 0, 1];
    const sym = solveStored(source, doc([{ id: 'mirror', kind: 'symmetry', span: { frames: [0, 30] }, blendMs: 0, axis: 'lateral', toleranceCm: .1, note: '좌우 대칭' }]));
    let mirrored = 0;
    for (const [i, row] of sym.constraints[0].rows.entries()) {
      if (!row) continue;
      const pose = sym.poses[i], inverse = q(pose.rotations.torso).invert(), root = new Vector3(...pose.root);
      const l = wrist(pose, 'left').sub(root).applyQuaternion(inverse), r = wrist(pose, 'right').sub(root).applyQuaternion(inverse);
      expect(new Vector3(-l.x, l.y, l.z).distanceTo(r)).toBeLessThan(.0011);
      if (row.status !== 'ok') continue;
      const pl = inverse.clone().multiply(forwardArm(pose, 'left').palm), pr = inverse.clone().multiply(forwardArm(pose, 'right').palm);
      expect(new Quaternion(pl.x, -pl.y, -pl.z, pl.w).angleTo(pr)).toBeLessThan(1e-6);
      mirrored++;
    }
    expect(mirrored).toBeGreaterThan(20);
    const offset = solveStored(source, doc([{ id: 'turn', kind: 'wristOffset', span: { frames: [4, 4] }, blendMs: 0, hand: 'left', degrees: [20, 0, 0], note: '왼손목 20도' }]));
    const edited = { ...source, edits: [{ frame: 4, side: 'left' as const, degrees: [20, 0, 0] as [number, number, number] }] };
    expect(forwardArm(offset.poses[4], 'left').palm.angleTo(forwardArm(editedPose(edited, 4), 'left').palm)).toBeLessThan(1e-9);
    expect(offset.changes.map(c => c.index)).toEqual([4]);
  });
  it('holds a hand still over its span and never creates a hidden arm', () => {
    const source = clip();
    for (const frame of source.frames.slice(12, 16)) frame.pose.quality.rightArm = 0;
    const solution = solveStored(source, doc([{ id: 'still', kind: 'hold', span: { frames: [10, 20] }, blendMs: 0, hand: 'right', note: '오른손 유지' }]));
    const positions = Array.from({ length: 11 }, (_, k) => k + 10).filter(i => !(i >= 12 && i < 16)).map(i => wrist(solution.poses[i], 'right'));
    for (const p of positions) expect(p.distanceTo(positions[0])).toBeLessThan(1e-3);
    for (let i = 12; i < 16; i++) {
      expect(solution.poses[i].rotations['right.upper']).toEqual(source.frames[i].pose.rotations['right.upper']);
      expect(solution.constraints[0].rows[i]!.status).toBe('unavailable');
    }
  });
  it('is pure and deterministic', () => {
    const source = deepFreeze(clip()), set = deepFreeze(height);
    const a = solveStored(source, set), b = solveStored(source, set);
    expect(JSON.stringify(a.poses)).toBe(JSON.stringify(b.poses));
    expect(a.constraints[0].rows).toEqual(b.constraints[0].rows);
  });
});

describe('handshape presets', () => {
  it('are anatomical tables within the reconstruction articulation limits and mirror for the right hand', () => {
    for (const id of PRESET_IDS) for (const side of SIDES) {
      const hand = { wrist: new Vector3(), palm: new Quaternion(), fingers: presetRotations(id, side) };
      const points = [new Vector3(), ...FINGERS.flatMap(f => fingerChain(hand, side, f))];
      // Feed the preset's own geometry back through the reconstruction: no unusual-articulation warnings.
      const palm = new Quaternion(), fingers = reconstructFingers(points.map(p => p.clone()), palm, side);
      if (fingers) expect(fingers.warnings).toEqual([]);
      expect(HANDSHAPES[id].label).not.toMatch(/\d지/);
    }
    const geometry = (id: typeof PRESET_IDS[number]) => {
      const hand = { wrist: new Vector3(), palm: new Quaternion(), fingers: presetRotations(id, 'left') };
      return Object.fromEntries(FINGERS.map(f => [f, fingerChain(hand, 'left', f)])) as Record<typeof FINGERS[number], Vector3[]>;
    };
    const palm = new Vector3(0, .042, .014);
    expect(Math.max(...(['index', 'middle', 'ring', 'pinky'] as const).map(f => geometry('fist')[f][3].distanceTo(palm)))).toBeLessThan(.04);
    expect(geometry('index-thumb-circle').thumb[3].distanceTo(geometry('index-thumb-circle').index[3])).toBeLessThan(.015);
    expect(geometry('index').index[3].y).toBeGreaterThan(.15);
    expect(geometry('index').middle[3].distanceTo(palm)).toBeLessThan(.04);
    const left = presetRotations('spread', 'left'), right = presetRotations('spread', 'right');
    for (const key of Object.keys(left)) {
      const mirrored = right[key.replace('left.', 'right.')];
      expect(new Quaternion(left[key].x, -left[key].y, -left[key].z, left[key].w).angleTo(mirrored)).toBeLessThan(1e-6);
    }
  });
});

describe('corrected MotionClip (version 2)', () => {
  const set = doc([
    { id: 'height', kind: 'sameHeight', span: { frames: [10, 30] }, points: ['left.wrist', 'right.wrist'], note: '양손 높이' },
    { id: 'shape', kind: 'handshape', span: { frames: [0, 6] }, blendMs: 0, hand: 'left', preset: 'flat', note: '왼손 편손' },
  ], { expression: 'ksl-test', request: '테스트 요청' });
  it('records the document, its hash, changed joints, original values and evidence; landmarks and quality stay', async () => {
    const source = clip();
    source.frames[2].pose.quality.leftState = 'held';
    const { clip: corrected } = await applyConstraints(source, set);
    expect(corrected.version).toBe(2);
    expect(corrected.pipeline).toEqual(source.pipeline);
    expect(corrected.constraints!.sha256).toBe(await constraintHash(set));
    expect(corrected.constraints!.document).toEqual(set);
    await verifyConstraintRecord(corrected);
    corrected.frames.forEach((frame, i) => {
      const original = source.frames[i];
      expect(frame.hands).toEqual(original.hands); expect(frame.body).toEqual(original.body); expect(frame.pose.quality).toEqual(original.pose.quality);
      if (!frame.constraint) { expect(frame.pose.rotations).toEqual(original.pose.rotations); return; }
      for (const joint of frame.constraint.joints) expect(frame.constraint.original[joint]).toEqual(original.pose.rotations[joint]);
      for (const key of Object.keys(frame.pose.rotations)) if (!frame.constraint.joints.includes(key)) expect(frame.pose.rotations[key]).toEqual(original.pose.rotations[key]);
    });
    expect(corrected.frames[2].constraint!.evidence.left).toBe('constrained');
    expect(corrected.frames[3].constraint!.evidence.left).toBe('observed');
    expect(corrected.frames.slice(7, 10).every(f => !f.constraint)).toBe(true);
  });
  it('round-trips through JSON, restores its exact source and re-applies from the source without stacking', async () => {
    const source = clip();
    source.edits = [{ frame: 3, side: 'right', degrees: [10, 0, 0] }];
    const { clip: corrected } = await applyConstraints(source, set);
    const json = (value: MotionClip) => JSON.parse(exportMotion(value));
    const loaded = importMotion(exportMotion(corrected));
    expect(json(loaded)).toEqual(json(corrected));
    expect(corrected.edits).toEqual([]);
    expect(corrected.frames[3].pose.rotations['right.wrist']).toEqual(editedPose(source, 3).rotations['right.wrist']);
    expect(json(sourceClip(loaded))).toEqual(json(source));
    const again = await applyConstraints(loaded, set);
    expect(json(again.clip)).toEqual(json(corrected));
    await expect(applyConstraints({ ...loaded, edits: [{ frame: 1, side: 'left', degrees: [5, 0, 0] }] }, set)).rejects.toThrow('wristOffset');
  });
  it('rejects a tampered record and constraint data labelled as version 1', async () => {
    const { clip: corrected } = await applyConstraints(clip(), set);
    const tampered = structuredClone(corrected); tampered.constraints!.document.constraints[0].note = '바뀐 메모';
    await expect(verifyConstraintRecord(importMotion(JSON.stringify(tampered)))).rejects.toThrow('해시');
    expect(() => importMotion(JSON.stringify({ ...corrected, version: 1 }))).toThrow('version 2');
    const missingOriginal = structuredClone(corrected); const changed = missingOriginal.frames.find(f => f.constraint)!;
    changed.constraint!.original = {};
    expect(() => importMotion(JSON.stringify(missingOriginal))).toThrow('original');
    expect(reconstructClip(corrected, 'improved')).toMatchObject({ version: 1 });
    expect(reconstructClip(corrected, 'improved').constraints).toBeUndefined();
  });
  it('keeps reading version-1 files: the fixture, published course 1 and a 0.3.1 record', () => {
    expect(importMotion(JSON.stringify(fixtureClip())).version).toBe(1);
    for (const id of ['ksl-thanks', 'ksl-sorry', 'ksl-meet']) {
      const loaded = importMotion(readFileSync(`public/content/assets/${id}/v1/reference.motion.json`, 'utf8'));
      expect(loaded.version).toBe(1); expect(loaded.pipeline.version).toBe('0.2.0'); expect(loaded.constraints).toBeUndefined();
    }
    const experimental = clip();
    experimental.pipeline = { ...experimental.pipeline, version: '0.3.1', temporal: { algorithm: 'conservative-bidirectional-v1', maxGapMs: 150, applies: 'learner-display' } };
    expect(importMotion(JSON.stringify(experimental)).pipeline.version).toBe('0.3.1');
  });
});

describe('display stage and learner screens', () => {
  const shape = doc([{ id: 'shape', kind: 'handshape', span: { frames: [0, 4] }, blendMs: 0, hand: 'left', preset: 'fist', note: '왼손 주먹' }]);
  /** Left hand unobserved for the first 9 frames (arm shown); frame 2's wrist leaves the image. */
  const lateLeft = () => {
    const source = clip();
    for (const frame of source.frames.slice(0, 9)) { frame.pose.quality.leftState = 'missing'; frame.pose.quality.left = 0; }
    source.frames[2].body[15] = { ...source.frames[2].body[15], x: -.2 };
    return source;
  };
  it('runs after torso stabilization and before hand filling, never after it', () => {
    expect(() => runDisplayPipeline({ clip: clip() }, [fillHands(), constrain(shape)])).toThrow('before hand-fill');
    expect(learnerStages(shape).map(s => s.id)).toEqual(['temporal-reconstruct', 'torso-stabilize', 'constraints', 'smooth-motion', 'hand-fill', 'rest-pose', 'hand-contact']);
    expect(learnerStages(shape, { presentation: false }).map(s => s.id)).toEqual(['temporal-reconstruct', 'torso-stabilize', 'constraints', 'hand-fill']);
    expect(PRESETS.learner().map(s => s.id)).toEqual(['temporal-reconstruct', 'torso-stabilize', 'smooth-motion', 'hand-fill', 'rest-pose', 'hand-contact']);
  });
  it('shows constrained hands, which hand filling neither overwrites nor hides', () => {
    const source = lateLeft();
    // Fill semantics without the presentation stages (the synthetic hands start low, where they would rest).
    const plain = runDisplayPipeline({ clip: source }, learnerStages(undefined, { presentation: false }));
    expect(plain.frames.slice(0, 9).map(f => f.annotation.hands.left.state)).toEqual(['filled', 'filled', 'missing', 'filled', 'filled', 'filled', 'filled', 'filled', 'filled']);
    expect(plain.frames[2].annotation.hands.left.hidden).toBe('offscreen');
    const display = runDisplayPipeline({ clip: deepFreeze(source) }, learnerStages(shape, { presentation: false }));
    expect(display.frames.slice(0, 5).map(f => f.annotation.hands.left.state)).toEqual(Array(5).fill('constrained'));
    expect(display.frames[0].annotation.hands.left.constraints).toEqual(['shape']);
    expect(display.frames.slice(5, 9).every(f => f.annotation.hands.left.state === 'filled')).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(display.frames[i].annotation.stages).toContain('constraints');
      expect(display.frames[i].annotation.stages).not.toContain('hand-fill');
      for (const [key, r] of Object.entries(presetRotations('fist', 'left'))) expect(q(display.frames[i].pose.rotations[key]).angleTo(r)).toBeLessThan(1e-6);
    }
    expect(hasConstrained(display)).toBe(true); expect(hasConstrained(plain)).toBe(false);
    // The fill safeguard still counts only observations.
    expect((display.reports['hand-fill-guard'] as { sides: { left: { anchors: number } } }).sides.left.anchors).toBe((plain.reports['hand-fill-guard'] as { sides: { left: { anchors: number } } }).sides.left.anchors);
    const pose = sampleDisplay(display, .05)!;
    expect(pose.hands?.left).toBe('constrained');
  });
  it('a corrected clip shows its stored constraints on learner screens, also under temporal reconstruction', async () => {
    const source = lateLeft();
    source.pipeline = { ...source.pipeline, temporal: { algorithm: 'conservative-bidirectional-v1', maxGapMs: 150, applies: 'learner-display' } };
    const { clip: corrected } = await applyConstraints(source, shape);
    const tracking = learnerStages(undefined, { presentation: false });
    const display = runDisplayPipeline({ clip: corrected }, tracking);
    expect(display.frames.slice(0, 5).map(f => f.annotation.hands.left.state)).toEqual(Array(5).fill('constrained'));
    for (let i = 0; i < 5; i++) for (const key of Object.keys(presetRotations('fist', 'left'))) expect(display.frames[i].pose.rotations[key]).toEqual(corrected.frames[i].pose.rotations[key]);
    expect(hasConstrained(display)).toBe(true);
    const unchanged = runDisplayPipeline({ clip: source }, tracking);
    expect(display.frames.slice(10).map(f => f.annotation.hands)).toEqual(unchanged.frames.slice(10).map(f => f.annotation.hands));
  });
});
