import type { ConstraintEvidence, DisplayPose, MotionClip, Side, TemporalMotion } from '../types';

/**
 * What the avatar draws for a hand. `filled` exists only in the display layer: it is never stored,
 * never evidence and never a Practice comparison input. `constrained`: a constraint set this hand's
 * shape (or produced the values of a hand that had no observation); legend "보정한 손 모양". `rest`: a relaxed
 * hand at the signer's rest position before or after the sign, never an observation (display only).
 */
export type DisplayHandState = 'observed' | 'interpolated' | 'held' | 'filled' | 'constrained' | 'rest' | 'missing';
/**
 * `hidden`: the fill safeguard kept this hand hidden (`missing`) instead of filling or holding it.
 * `constraints`: ids of the constraints that changed this hand (preview stage or a corrected clip's record).
 * `evidence`: for a constrained hand, whether the constraint adjusted an observed hand (`observed`) or produced the
 * values of a hand with no observation (`constrained`). Only the former counts as observed evidence.
 */
/**
 * `restWeight`: how far the rest stage blended this hand toward the relaxed rest hand (0–1); the avatar fades its color
 * by it. `under`: for a `rest` hand still morphing, the state of the handshape it morphs from (its color fades out).
 */
export type HandAnnotation = { state: DisplayHandState; fill?: 'lead' | 'trail' | 'gap'; anchors?: [number, number]; hidden?: 'insufficient-evidence' | 'offscreen'; constraints?: string[]; evidence?: ConstraintEvidence; restWeight?: number; under?: DisplayHandState };
export type TorsoAnnotation = {
  mode: 'fixed' | 'smoothed';
  /** Angle between the reconstructed and the displayed torso. */
  deviationDegrees: number;
  /** Displayed minus reconstructed wrist position (meters); nonzero only where fixed arm reach clamps. */
  wristResidual: Record<Side, number>;
  elbowShift: Record<Side, number>;
};
/** `arms[side] = 'rest'`: the arm was not tracked here and is drawn at the rest position (display only). */
/** `contact`: the hands overlapped by `before` meters and were moved apart by `shift`; `after` is what fixed reach left. */
export type ContactAnnotation = { before: number; after: number; shift: Record<Side, number> };
export type DisplayAnnotation = { hands: Record<Side, HandAnnotation>; arms?: Partial<Record<Side, 'rest'>>; torso?: TorsoAnnotation; contact?: ContactAnnotation; stages: string[] };
/** `segment` changes at sequence boundaries (cuts, detection gaps); nothing is bridged across it. */
export type DisplayFrame = { timestamp: number; segment: number; pose: DisplayPose; annotation: DisplayAnnotation };
export type DisplayInput = { clip: MotionClip; temporal?: TemporalMotion };
export type DisplayClip = { frames: DisplayFrame[]; stages: string[]; reports: Record<string, unknown> };
/**
 * One pure post-processing step. It receives the whole clip (statistics and two-sided filters need it)
 * and returns new frames; it must not mutate its input. Constraint correction (`constrain`) uses the same
 * signature and runs after torso stabilization and before hand filling.
 */
export type DisplayStage = { id: string; run(display: DisplayClip, input: DisplayInput): DisplayClip };
/** A sampled pose plus the display state of each hand, as the avatar consumes it. */
export type AvatarPose = DisplayPose & {
  hands?: Partial<Record<Side, DisplayHandState>>; arms?: Partial<Record<Side, 'rest'>>;
  /** Rest blend per hand (color fade) and, for a morphing rest hand, the state it morphs from. */
  rest?: Partial<Record<Side, { weight: number; under?: DisplayHandState }>>;
};
export type HandFocus = { center: [number, number, number]; radius: number };
