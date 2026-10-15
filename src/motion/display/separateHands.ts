import { handsOf, leftward, moveWrist, separateHands, TOUCH_METERS } from '../handContact';
import { SIDES, type Side } from '../types';
import { armVisible, withPose } from './pipeline';
import type { DisplayClip, DisplayStage } from './types';

export const CONTACT_STAGE = 'hand-contact';
export type ContactReport = { frames: number; maxBefore: number; maxAfter: number; maxShift: number };

/**
 * Hands never pass into each other on learner screens. Where the two hands' volumes overlap (estimation noise, or two
 * hands brought together by a contact constraint), both hands are moved apart by equal shares until their surfaces
 * just touch; each arm is re-solved to its new wrist with the palm and fingers unchanged. Display only.
 */
export function separate(): DisplayStage {
  return { id: CONTACT_STAGE, run(display: DisplayClip): DisplayClip {
    const report: ContactReport = { frames: 0, maxBefore: 0, maxAfter: 0, maxShift: 0 };
    const frames = display.frames.map(frame => {
      const shown = (side: Side) => armVisible(frame.pose, side) || frame.annotation.arms?.[side] === 'rest';
      if (!SIDES.every(side => shown(side) && frame.annotation.hands[side].state !== 'missing')) return frame;
      const hands = handsOf(frame.pose), result = separateHands(hands.left, hands.right, leftward(frame.pose));
      if (result.before <= TOUCH_METERS) return frame;
      const pose = { ...frame.pose, rotations: { ...frame.pose.rotations } };
      for (const side of SIDES) moveWrist(pose, side, hands[side].wrist);
      // Fixed arm reach can stop a hand short; measure what remains on the solved pose.
      const solved = handsOf(pose), after = separateHands(solved.left, solved.right, leftward(pose)).before;
      const shift = { left: result.shift.left.length(), right: result.shift.right.length() };
      report.frames++; report.maxBefore = Math.max(report.maxBefore, result.before); report.maxAfter = Math.max(report.maxAfter, after);
      report.maxShift = Math.max(report.maxShift, shift.left, shift.right);
      return withPose(frame, pose, CONTACT_STAGE, { contact: { before: result.before, after, shift } });
    });
    return { ...display, frames, reports: { ...display.reports, [CONTACT_STAGE]: report } };
  } };
}
