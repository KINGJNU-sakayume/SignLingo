import { Vector3 } from 'three';
import { confidence, q, qa, rad, solveArm } from './math';
import { forwardArm } from './rig';
import { Reconstructor } from './reconstruct';
import { distributeForearmRoll } from './hand';
import { reconcileAssociations, sequenceBoundary, TemporalHandTracker, wristInImage as inImage, type HandAssociation } from './tracking';
import { FINGERS, SIDES, type DisplayPose, type HandEvidence, type MotionClip, type MotionFrame, type Pose, type Side, type TemporalFrame, type TemporalMotion } from './types';

export type TemporalProgress = { phase: string; done: number; total: number };
export type TemporalOptions = { maxGapMs?: number; signal?: AbortSignal; progress?: (progress: TemporalProgress) => void };
const emptyEvidence = (): HandEvidence => ({ state: 'unavailable', position: 'unavailable', orientation: 'unavailable', fingers: 'unavailable', identity: 'unavailable' });
const fingerKeys = (side: Side) => FINGERS.flatMap(f => [0, 1, 2].map(j => `${side}.${f}.${j}`));

// Only inferred articulation is constrained. Unusual observed signs are preserved.
export function validInferredFingers(pose: Pose, side: Side): boolean {
  return FINGERS.every((finger, f) => [0, 1, 2].every(j => {
    const direction = new Vector3(0, 1, 0).applyQuaternion(q(pose.rotations[`${side}.${finger}.${j}`]));
    const flex = Math.atan2(direction.z, direction.y);
    const spread = -Math.atan2(direction.x, Math.hypot(direction.y, direction.z));
    return flex >= rad(f === 0 ? -60 : j === 0 ? -35 : -20) &&
      flex <= rad(f === 0 ? 130 : j === 0 ? 115 : 140) &&
      Math.abs(spread) <= rad(f === 0 ? (j === 0 ? 90 : 35) : (j === 0 ? 45 : 20));
  }));
}

function bridgePose(a: Pose, b: Pose, current: DisplayPose, side: Side, t: number): DisplayPose | null {
  const pose = { ...current, rotations: { ...current.rotations } };
  const start = forwardArm(a, side), end = forwardArm(b, side);
  // Wrist position uses actual body observations when available. If missing,
  // solve a fixed-length arm toward the interpolated wrist and elbow pole.
  if (current.evidence![side].position !== 'observed') {
    const torso = q(current.rotations.torso);
    const shoulder = new Vector3(side === 'left' ? .19 : -.19, 0, 0).applyQuaternion(torso).add(new Vector3(...current.root));
    const arm = solveArm(shoulder, start.wrist.clone().lerp(end.wrist, t), start.elbow.clone().lerp(end.elbow, t));
    if (arm.correction > .02 || arm.unstable) return null;
    pose.rotations[`${side}.upper`] = qa(torso.clone().invert().multiply(arm.upperQ));
    pose.rotations[`${side}.lower`] = qa(arm.upperQ.clone().invert().multiply(arm.lowerQ));
  }
  const arm = forwardArm(pose, side);
  // Interpolate world palm, then attach to CURRENT forearm, avoiding roll jumps.
  const palm = start.palm.clone().slerp(end.palm, t).normalize();
  const { forearm, wrist, swing } = distributeForearmRoll(arm.lower, palm);
  if (swing > rad(115)) return null;
  // Use the same roll allocation as observed reconstruction. The wrist endpoint
  // stays fixed; the wrist-local rotation must not absorb an entire forearm roll.
  pose.rotations[`${side}.lower`] = qa(arm.upper.clone().invert().multiply(forearm));
  pose.rotations[`${side}.wrist`] = qa(wrist);
  const compatibleShape = fingerKeys(side).every(key => q(a.rotations[key]).angleTo(q(b.rotations[key])) <= rad(45));
  for (const key of fingerKeys(side)) pose.rotations[key] = qa(q(a.rotations[key]).slerp(q(b.rotations[key]), t).normalize());
  const fingers = compatibleShape && validInferredFingers(pose, side);
  if (!fingers) for (const key of fingerKeys(side)) pose.rotations[key] = current.rotations[key];
  pose.evidence = { ...current.evidence!, [side]: { ...current.evidence![side], fingers: fingers ? 'interpolated' : 'unavailable',
    reason: fingers ? 'surrounding-observations' : compatibleShape ? 'anatomical-constraint' : 'incompatible-handshape' } };
  return pose;
}

function compatible(a: MotionFrame, b: MotionFrame, side: Side, maxGap: number, inferPosition: boolean): string | undefined {
  const dt = b.timestamp - a.timestamp;
  if (dt > maxGap + 1e-6) return 'long-gap';
  if (Math.min(a.pose.quality[side], b.pose.quality[side]) < .6) return 'weak-endpoint';
  if (!inImage(a, side) || !inImage(b, side)) return 'outside-image';
  const first = forwardArm(a.pose, side), last = forwardArm(b.pose, side);
  const speed = first.wrist.distanceTo(last.wrist) / (dt / 1000);
  if (inferPosition && (speed > 3 || (speed > 1.5 && dt > 80))) return 'fast-motion';
  if (first.palm.angleTo(last.palm) > rad(75)) return 'incompatible-palm';
  const poleA = first.elbow.clone().sub(first.shoulder), poleB = last.elbow.clone().sub(last.shoulder);
  if (poleA.angleTo(poleB) > rad(80)) return 'incompatible-arm';
}

/** Shared generator keeps offline evaluation and interruptible browser work identical. */
function* temporalSteps(clip: MotionClip, options: TemporalOptions): Generator<TemporalProgress, TemporalMotion> {
  const started = performance.now(), input = clip.frames, count = input.length;
  if (options.maxGapMs !== undefined && !Number.isFinite(options.maxGapMs)) throw new RangeError('Temporal gap must be finite.');
  const maxGapMs = Math.min(150, Math.max(0, options.maxGapMs ?? 150));
  const progress = (phase: string, done: number): TemporalProgress => ({ phase, done, total: count });
  const boundaries = input.map((f, i) => i === 0 || sequenceBoundary(input[i - 1], f));
  const tracker = new TemporalHandTracker(), forward: HandAssociation[] = [], backward: HandAssociation[] = [];
  for (let i = 0; i < count; i++) {
    if (boundaries[i]) tracker.reset();
    forward[i] = tracker.assign(input[i]);
    yield progress('시간순 손 구분', i + 1);
  }
  tracker.reset();
  for (let i = count - 1; i >= 0; i--) {
    if (i === count - 1 || boundaries[i + 1]) tracker.reset();
    backward[i] = tracker.assign(input[i]);
    yield progress('역순 손 구분', count - i);
  }
  const observations: MotionFrame[] = [], frames: TemporalFrame[] = [];
  let solver = new Reconstructor();
  for (let i = 0; i < count; i++) {
    if (boundaries[i]) solver = new Reconstructor();
    const source = input[i], association = reconcileAssociations(forward[i], backward[i]);
    const reconstructed = solver.reconstruct(source, { assignment: association.assignment, warnings: [] });
    const evidence = { left: emptyEvidence(), right: emptyEvidence() };
    const rotations = { ...source.pose.rotations };
    const observation = { ...reconstructed, pose: { ...reconstructed.pose, rotations: { ...reconstructed.pose.rotations } } };
    for (const side of SIDES) {
      const e = evidence[side]; e.identity = association.identity[side];
      if (source.pose.quality.body >= .6 && source.pose.quality[`${side}Arm`] >= .6 && inImage(source, side)) e.position = 'observed';
      const reliable = e.identity === 'reliable' && reconstructed.pose.quality[`${side}State`] === 'tracked';
      if (reliable) {
        const same = association.assignment[side] === source.assignment[side] && source.pose.quality[`${side}State`] === 'tracked';
        // Exact hard anchors: no temporal filter touches a reliable stored pose.
        const observed = same ? source.pose : reconstructed.pose;
        for (const key of Object.keys(rotations)) if (key.startsWith(`${side}.`)) rotations[key] = observed.rotations[key];
        Object.assign(observation.pose.rotations, Object.fromEntries(Object.entries(observed.rotations).filter(([key]) => key.startsWith(`${side}.`))));
        observation.pose.quality = { ...observation.pose.quality, [side]: observed.quality[side], [`${side}State`]: 'tracked' };
        e.state = e.orientation = e.fingers = 'observed';
        if (observed.quality[side] < .6) e.reason = 'weak-observation';
      } else e.reason = e.identity === 'ambiguous' ? 'ambiguous-identity' : 'missing-observation';
    }
    observations.push(observation);
    // Quality retains the baseline contract. Rendering uses explicit evidence.
    frames.push({ timestamp: source.timestamp, assignment: association.assignment,
      pose: { ...source.pose, rotations, evidence } });
    yield progress('관측 근거 분리', i + 1);
  }
  for (const side of SIDES) {
    let anchor = -1;
    for (let i = 0; i < count; i++) {
      if (boundaries[i]) anchor = -1;
      const e = frames[i].pose.evidence![side];
      if (e.state === 'observed') {
        if (anchor >= 0 && i > anchor + 1) {
          let reason = compatible(observations[anchor], observations[i], side, maxGapMs, frames.slice(anchor + 1, i).some(f => f.pose.evidence![side].position !== 'observed'));
          for (let j = anchor + 1; !reason && j < i; j++) {
            if (frames[j].pose.evidence![side].identity === 'ambiguous') reason = 'ambiguous-identity';
            else if (input[j].pose.quality.body < .6) reason = 'missing-torso';
            else {
              const wrist = input[j].body[side === 'left' ? 15 : 16];
              if (confidence(wrist) >= .45 && !inImage(input[j], side)) reason = 'outside-image';
            }
          }
          const proposed: DisplayPose[] = [];
          for (let j = anchor + 1; !reason && j < i; j++) {
            const t = (input[j].timestamp - input[anchor].timestamp) / (input[i].timestamp - input[anchor].timestamp);
            const pose = bridgePose(observations[anchor].pose, observations[i].pose, frames[j].pose, side, t);
            if (!pose) reason = 'anatomical-constraint'; else proposed.push(pose);
          }
          for (let j = anchor + 1; j < i; j++) {
            const old = frames[j].pose.evidence![side];
            if (reason) { old.reason = reason; continue; }
            const pose = proposed[j - anchor - 1];
            pose.evidence = { ...pose.evidence!, [side]: { ...old, state: 'interpolated', orientation: 'interpolated', fingers: pose.evidence![side].fingers,
              position: old.position === 'observed' ? 'observed' : 'interpolated', anchors: [anchor, i], reason: pose.evidence![side].reason } };
            frames[j].pose = pose;
          }
        }
        anchor = i;
      }
      yield progress(side === 'left' ? '왼손 짧은 누락 복원' : '오른손 짧은 누락 복원', i + 1);
    }
  }
  // A short visual hold has no measured confidence. No hold at ambiguous
  // crossings, outside the image, after cuts, or following an inferred anchor.
  const last: Record<Side, number> = { left: -1, right: -1 };
  for (let i = 0; i < count; i++) {
    if (boundaries[i]) last.left = last.right = -1;
    for (const side of SIDES) {
      const e = frames[i].pose.evidence![side];
      if (e.state === 'observed') { last[side] = i; continue; }
      const a = last[side];
      if (e.state === 'interpolated' || a < 0 || input[i].timestamp - input[a].timestamp > 80 || e.position !== 'observed' || e.identity === 'ambiguous') continue;
      // A rejected bridge is unavailable; holding it would disguise its failure.
      if (e.reason !== 'missing-observation') continue;
      const old = frames[a].pose, pose = frames[i].pose, arm = forwardArm(pose, side);
      pose.rotations[`${side}.wrist`] = qa(arm.lower.clone().invert().multiply(forwardArm(old, side).palm));
      for (const key of fingerKeys(side)) pose.rotations[key] = old.rotations[key];
      e.state = e.orientation = e.fingers = 'held'; e.reason = 'past-observation-at-most-80ms';
    }
    yield progress('복원 근거 확인', i + 1);
  }
  return { algorithm: 'conservative-bidirectional-v1', frames, maxGapMs, elapsedMs: performance.now() - started };
}

export function reconstructTemporal(clip: MotionClip, options: TemporalOptions = {}): TemporalMotion {
  const steps = temporalSteps(clip, options);
  for (;;) {
    options.signal?.throwIfAborted();
    const step = steps.next();
    if (step.done) return step.value;
    options.progress?.(step.value);
  }
}

export async function reconstructTemporalAsync(clip: MotionClip, options: TemporalOptions = {}): Promise<TemporalMotion> {
  const steps = temporalSteps(clip, options);
  let batch = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const step = steps.next();
    if (step.done) return step.value;
    if (++batch % 16 === 0 || step.value.done === step.value.total) {
      options.progress?.(step.value);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
}
