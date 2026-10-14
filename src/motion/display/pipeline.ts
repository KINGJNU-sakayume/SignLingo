import { Vector3 } from 'three';
import { blendPose, editedPose, timestampIndex, type BlendRules } from '../player';
import { forwardHand } from '../rig';
import { sequenceBoundary } from '../tracking';
import { SIDES, type DisplayPose, type Side } from '../types';
import type { AvatarPose, DisplayClip, DisplayFrame, DisplayHandState, DisplayInput, DisplayStage, HandFocus } from './types';

function baseHand(pose: DisplayPose, side: Side): DisplayHandState {
  const evidence = pose.evidence?.[side];
  if (evidence) return evidence.state === 'unavailable' ? 'missing' : evidence.state;
  const state = pose.quality[`${side}State`];
  return state === 'tracked' ? 'observed' : state;
}
/** Arms the avatar shows: the same rule as Avatar.tsx, so stages only touch what is visible. */
export function armVisible(pose: DisplayPose, side: Side) {
  return pose.quality.body > 0 && (pose.quality[`${side}Arm`] > 0 || pose.evidence?.[side].position === 'interpolated');
}
/** Finger rotations exist for this hand (fills supply them even when evidence does not). */
export function fingersShown(frame: DisplayFrame, side: Side) {
  return frame.annotation.hands[side].state === 'filled' || frame.pose.evidence?.[side].fingers !== 'unavailable';
}

/** Stored poses with wrist edits applied, as playback has always shown them; the clip is not modified. */
export function baseFrames({ clip, temporal }: DisplayInput): DisplayFrame[] {
  let segment = 0;
  return clip.frames.map((frame, i) => {
    if (i > 0 && sequenceBoundary(clip.frames[i - 1], frame)) segment++;
    const pose = editedPose(clip, i, temporal);
    return { timestamp: frame.timestamp, segment, pose, annotation: { hands: { left: { state: baseHand(pose, 'left') }, right: { state: baseHand(pose, 'right') } }, stages: [] } };
  });
}
export function runDisplayPipeline(input: DisplayInput, stages: readonly DisplayStage[]): DisplayClip {
  let display: DisplayClip = { frames: baseFrames(input), stages: [], reports: {} };
  for (const stage of stages) {
    const next = stage.run(display, input);
    display = { ...next, stages: [...display.stages, stage.id] };
  }
  return display;
}
/** Copy-on-write helper for stages. */
export function withPose(frame: DisplayFrame, pose: DisplayPose, stage: string, annotation: Partial<DisplayFrame['annotation']> = {}): DisplayFrame {
  return { ...frame, pose, annotation: { ...frame.annotation, ...annotation, stages: [...frame.annotation.stages, stage] } };
}

const displayRules = (frame: DisplayFrame): BlendRules<DisplayPose> => ({
  hand: (_pose, side) => ['observed', 'interpolated', 'filled'].includes(frame.annotation.hands[side].state),
  fingers: (_pose, side) => fingersShown(frame, side),
});
const avatarPose = (frame: DisplayFrame, pose: DisplayPose): AvatarPose =>
  ({ ...pose, hands: { left: frame.annotation.hands.left.state, right: frame.annotation.hands.right.state } });

export function displayPose(display: DisplayClip, index: number): AvatarPose | null {
  const frame = display.frames[Math.max(0, Math.min(index, display.frames.length - 1))];
  return frame ? avatarPose(frame, frame.pose) : null;
}
/** Same timing rules as samplePose(): no blending across long gaps, missing torsos or segments. */
export function sampleDisplay(display: DisplayClip, seconds: number): AvatarPose | null {
  const frames = display.frames;
  if (!frames.length) return null;
  const i = timestampIndex(frames, seconds), j = Math.min(i + 1, frames.length - 1);
  const a = frames[i], b = frames[j], gap = b.timestamp - a.timestamp;
  const t = gap > 0 ? Math.max(0, Math.min(1, (seconds * 1000 - a.timestamp) / gap)) : 0;
  if (gap > 200 || !a.pose.quality.body || !b.pose.quality.body || a.segment !== b.segment) return avatarPose(a, a.pose);
  return avatarPose(a, blendPose(a.pose, b.pose, t, displayRules(a), displayRules(b)));
}
export const hasFilled = (display: DisplayClip | null | undefined) =>
  !!display?.frames.some(f => SIDES.some(side => f.annotation.hands[side].state === 'filled'));
export const displayDuration = (display: DisplayClip) => (display.frames.at(-1)?.timestamp ?? 0) / 1000;

/**
 * One fixed framing around the observed signing space of the given clips (5th–95th percentile of
 * wrist and fingertip positions, so resting or filled lead-in hands do not widen it). The camera
 * never follows the hands frame by frame, which would itself cause motion sickness.
 */
export function handFocus(displays: readonly DisplayClip[]): HandFocus | null {
  const collect = (states: DisplayHandState[]) => {
    const points: Vector3[] = [];
    for (const display of displays) for (const frame of display.frames) for (const side of SIDES) {
      if (!armVisible(frame.pose, side) || !states.includes(frame.annotation.hands[side].state)) continue;
      points.push(...forwardHand(frame.pose, side).points);
    }
    return points;
  };
  const points = collect(['observed', 'interpolated']);
  if (!points.length) points.push(...collect(['held', 'filled']));
  if (!points.length) return null;
  const axis = (k: 'x' | 'y' | 'z') => { const values = points.map(p => p[k]).sort((a, b) => a - b); return [values[Math.floor(.05 * (values.length - 1))], values[Math.ceil(.95 * (values.length - 1))]]; };
  const [x, y, z] = [axis('x'), axis('y'), axis('z')];
  const half = new Vector3(x[1] - x[0], y[1] - y[0], z[1] - z[0]).multiplyScalar(.5);
  return { center: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], radius: Math.max(.12, half.length()) };
}
