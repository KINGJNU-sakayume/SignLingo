import { solveConstraints, type ConstraintSolution, type HandSource } from '../constraints/solve';
import type { ConstraintSet } from '../constraints/schema';
import { SIDES } from '../types';
import { FILL_STAGE } from './fillHands';
import { constrainedState, withPose } from './pipeline';
import type { DisplayClip, DisplayHandState, DisplayStage, HandAnnotation } from './types';

export const CONSTRAINT_STAGE = 'constraints';
/** `reports.constraints`: residuals and changes of the preview (poses omitted). */
export type ConstraintReport = Omit<ConstraintSolution, 'poses'>;
const source = (state: DisplayHandState): HandSource => state === 'observed' ? 'observed' : state === 'missing' ? 'missing' : 'held';

/**
 * Preview of a constraint set on the displayed frames: the same solver the corrected export uses, applied after
 * torso stabilization and before hand filling. Hands whose shape a constraint set (or that had no observation)
 * become `constrained`; hand filling then neither overwrites nor hides them. Nothing is stored.
 */
export function constrain(set: ConstraintSet): DisplayStage {
  return { id: CONSTRAINT_STAGE, run(display: DisplayClip, input): DisplayClip {
    if (display.stages.includes(FILL_STAGE)) throw new Error(`${CONSTRAINT_STAGE} must run before ${FILL_STAGE}.`);
    const solution = solveConstraints({ clip: input.clip, poses: display.frames.map(f => f.pose), timestamps: display.frames.map(f => f.timestamp),
      hands: (i, side) => source(display.frames[i].annotation.hands[side].state), set });
    const frames = display.frames.slice();
    for (const change of solution.changes) {
      const frame = frames[change.index], hands = { ...frame.annotation.hands };
      for (const side of SIDES) {
        if (!change.evidence[side]) continue;
        const state = constrainedState(hands[side].state, !!change.fingers[side], change.evidence[side]);
        hands[side] = { ...hands[side], state, constraints: change.applied.map(a => a.id), evidence: change.evidence[side] } satisfies HandAnnotation;
      }
      frames[change.index] = withPose(frame, solution.poses[change.index], CONSTRAINT_STAGE, { hands });
    }
    const { poses: _poses, ...report } = solution;
    return { ...display, frames, reports: { ...display.reports, [CONSTRAINT_STAGE]: report satisfies ConstraintReport } };
  } };
}
