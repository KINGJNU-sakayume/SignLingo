import { boneQuaternion, q, qa } from '../math';
import { distributeForearmRoll } from '../hand';
import { forwardArm } from '../rig';
import { FINGERS, SIDES, type DisplayPose, type Side } from '../types';
import { armVisible, fingersShown, withPose } from './pipeline';
import type { DisplayClip, DisplayFrame, DisplayStage, HandAnnotation } from './types';

export const FILL_STAGE = 'hand-fill';
export type FillReport = Record<Side, { lead: number; gap: number; trail: number }>;
const fingerKeys = (side: Side) => FINGERS.flatMap(f => [0, 1, 2].map(j => `${side}.${f}.${j}`));

/**
 * The forearm frame without its allocated axial roll, recomputed from the arm geometry exactly as
 * solveArm() builds it. Hand orientation is filled relative to this frame and then split between
 * forearm roll and wrist with distributeForearmRoll(), like the reconstruction does.
 */
function bareForearm(pose: DisplayPose, side: Side) {
  const arm = forwardArm(pose, side);
  const upper = arm.elbow.clone().sub(arm.shoulder), lower = arm.wrist.clone().sub(arm.elbow);
  return { arm, frame: boneQuaternion(lower, upper.clone().cross(lower).normalize()) };
}
/** Hand orientation relative to the roll-free forearm, and finger rotations: what a fill copies or blends. */
export const handShape = (pose: DisplayPose, side: Side) => {
  const { arm, frame } = bareForearm(pose, side);
  return { relative: frame.clone().invert().multiply(arm.palm).normalize(), fingers: fingerKeys(side).map(key => q(pose.rotations[key])) };
};
const isAnchor = (frame: DisplayFrame, side: Side) => {
  const state = frame.annotation.hands[side].state;
  return state === 'observed' || (state === 'interpolated' && fingersShown(frame, side));
};

/**
 * Display-only handshapes for hands that are held or missing while their arm is shown: before the
 * first observation the first observed shape, after the last one the last shape, and in between a
 * time-proportional slerp of the surrounding observed shapes (finger rotations and the wrist's
 * rotation relative to the forearm). Stored clips, reconstruct.ts's 200 ms hold and evidence are untouched.
 */
export function fillHands(): DisplayStage {
  return { id: FILL_STAGE, run(display: DisplayClip): DisplayClip {
    const frames = display.frames.slice();
    const report: FillReport = { left: { lead: 0, gap: 0, trail: 0 }, right: { lead: 0, gap: 0, trail: 0 } };
    for (const side of SIDES) {
      const segments = new Map<number, number[]>();
      display.frames.forEach((f, i) => segments.set(f.segment, [...segments.get(f.segment) ?? [], i]));
      for (const indices of segments.values()) {
        const anchors = indices.filter(i => isAnchor(display.frames[i], side));
        if (!anchors.length) continue;
        const shapes = new Map(anchors.map(i => [i, handShape(display.frames[i].pose, side)]));
        let k = 0;
        for (const i of indices) {
          while (k < anchors.length && anchors[k] < i) k++;
          const source = display.frames[i];
          if (isAnchor(source, side) || !armVisible(source.pose, side)) continue;
          const before = anchors[k - 1], after = anchors[k];
          const kind: HandAnnotation['fill'] = before === undefined ? 'lead' : after === undefined ? 'trail' : 'gap';
          const a = shapes.get(before ?? after)!, b = shapes.get(after ?? before)!;
          const t = kind === 'gap' ? (source.timestamp - display.frames[before].timestamp) / (display.frames[after].timestamp - display.frames[before].timestamp) : 0;
          const rotations = { ...frames[i].pose.rotations }, pose = { ...frames[i].pose, rotations };
          fingerKeys(side).forEach((key, n) => { rotations[key] = qa(a.fingers[n].clone().slerp(b.fingers[n], t).normalize()); });
          // A temporal bridge already interpolated this palm; only its missing fingers are filled.
          if (source.annotation.hands[side].state !== 'interpolated') {
            const { arm, frame } = bareForearm(pose, side);
            const palm = frame.clone().multiply(a.relative.clone().slerp(b.relative, t)).normalize();
            const { forearm, wrist } = distributeForearmRoll(frame, palm);
            rotations[`${side}.lower`] = qa(arm.upper.clone().invert().multiply(forearm));
            rotations[`${side}.wrist`] = qa(wrist);
          }
          const hand: HandAnnotation = { state: 'filled', fill: kind, anchors: [before ?? after, after ?? before] };
          frames[i] = withPose(frames[i], pose, FILL_STAGE, { hands: { ...frames[i].annotation.hands, [side]: hand } });
          report[side][kind]++;
        }
      }
    }
    return { ...display, frames, reports: { ...display.reports, [FILL_STAGE]: report } };
  } };
}
