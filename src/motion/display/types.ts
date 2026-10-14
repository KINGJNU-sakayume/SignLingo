import type { DisplayPose, MotionClip, Side, TemporalMotion } from '../types';

/**
 * What the avatar draws for a hand. `filled` exists only in the display layer: it is never stored,
 * never evidence and never a Practice comparison input.
 */
export type DisplayHandState = 'observed' | 'interpolated' | 'held' | 'filled' | 'missing';
export type HandAnnotation = { state: DisplayHandState; fill?: 'lead' | 'trail' | 'gap'; anchors?: [number, number] };
export type TorsoAnnotation = {
  mode: 'fixed' | 'smoothed';
  /** Angle between the reconstructed and the displayed torso. */
  deviationDegrees: number;
  /** Displayed minus reconstructed wrist position (meters); nonzero only where fixed arm reach clamps. */
  wristResidual: Record<Side, number>;
  elbowShift: Record<Side, number>;
};
export type DisplayAnnotation = { hands: Record<Side, HandAnnotation>; torso?: TorsoAnnotation; stages: string[] };
/** `segment` changes at sequence boundaries (cuts, detection gaps); nothing is bridged across it. */
export type DisplayFrame = { timestamp: number; segment: number; pose: DisplayPose; annotation: DisplayAnnotation };
export type DisplayInput = { clip: MotionClip; temporal?: TemporalMotion };
export type DisplayClip = { frames: DisplayFrame[]; stages: string[]; reports: Record<string, unknown> };
/**
 * One pure post-processing step. It receives the whole clip (statistics and two-sided filters need it)
 * and returns new frames; it must not mutate its input. Future stages such as anatomical constraint
 * correction use the same signature and can be placed anywhere in a stage list.
 */
export type DisplayStage = { id: string; run(display: DisplayClip, input: DisplayInput): DisplayClip };
/** A sampled pose plus the display state of each hand, as the avatar consumes it. */
export type AvatarPose = DisplayPose & { hands?: Partial<Record<Side, DisplayHandState>> };
export type HandFocus = { center: [number, number, number]; radius: number };
