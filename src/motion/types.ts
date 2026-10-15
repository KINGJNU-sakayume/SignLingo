export type Side = 'left' | 'right';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Landmark = { x: number; y: number; z: number; visibility?: number; presence?: number };
// `origin` is recorded from pipeline 0.3.x: 'region' hands were re-detected in a pose-predicted crop
// and mapped back to full-frame image coordinates. Absent in 0.1.0/0.2.0 clips (full frame only).
export type HandDetection = { image: Landmark[]; world: Landmark[]; label: string; score: number; origin?: 'frame' | 'region' };
export type Detection = { timestamp: number; body: Landmark[]; bodyWorld: Landmark[]; hands: HandDetection[]; discontinuity?: 'cut' };
export type TrackingState = 'tracked' | 'held' | 'missing';
export type Quality = { body: number; left: number; right: number; leftArm: number; rightArm: number; leftState: TrackingState; rightState: TrackingState };
export type Correction = { joint: string; kind: string; amount: number };
export type Pose = { root: Vec3; rotations: Record<string, Quat>; quality: Quality };
export type MotionFrame = Detection & { pose: Pose; warnings: string[]; corrections: Correction[]; assignment: Partial<Record<Side, number>> };
export type WristEdit = { frame: number; side: Side; degrees: Vec3 };
/** Pose-guided hand crop re-detection parameters (0.3.1 gap-fill), recorded verbatim in the clip. */
export type HandRegionSettings = {
  method: 'pose-forearm-roi-v2-gapfill';
  /** Square crop edge after upscaling, in pixels. */
  cropSize: number;
  /** Crop edge as a multiple of the (floored) image-space forearm length. */
  sizeToForearm: number;
  /** Crop center: wrist plus this many forearm lengths toward the hand. */
  centerAlongHand: number;
  /** Forearm length floor as a fraction of shoulder span (foreshortened forearms). */
  minShoulderFraction: number;
  minWristConfidence: number;
  /** Elbow / pose finger landmarks below this only stop guiding the crop direction or size. */
  minGuideConfidence: number;
  /** Smaller predicted squares are skipped: there is nothing to upscale. */
  minRegionPixels: number;
  /** Crops are cut from the decoded frame scaled to at most this long side (the full-frame pass keeps its own size). */
  cropSourceMaxDimension: number;
  /**
   * Gap-fill: full-frame hands are kept unchanged; only sides the wrist rule left without a hand get a region
   * candidate, at most one per side, chosen by distance to that side's pose wrist (≤ `maxWristDistance`,
   * score ≥ `minScore`), never by handedness label. A candidate within `sameHand` palm lengths of a full-frame
   * hand is that hand again and is dropped. A fill is kept only if the wrist rule still assigns every
   * full-frame hand as before and puts the fill on its own side.
   */
  fusion: { rule: 'gap-fill-per-side'; sameHand: number; maxWristDistance: number; minScore: number; perSide: 1 };
  landmarker: { runningMode: 'IMAGE'; numHands: number; minHandDetectionConfidence: number; minHandPresenceConfidence: number };
};
/**
 * 0.3.0 record (read-only): all full-frame and region hands competed by handedness score, top 2 kept. Replaced by
 * 0.3.1 gap-fill after it displaced correctly assigned full-frame hands; existing 0.3.0 clips still load.
 */
export type LegacyHandRegionSettings = Omit<HandRegionSettings, 'method' | 'fusion'> & {
  method: 'pose-forearm-roi-v1';
  fusion: { rule: 'max-score-landmark-nms'; sameHand: number; sameHandOppositeLabel: number; maxHands: number };
};
/** Display policy recorded by 0.3.x: the learner preset applies this temporal reconstruction first. */
export type TemporalPolicy = { algorithm: 'conservative-bidirectional-v1'; maxGapMs: number; applies: 'learner-display' };
export type PipelineInfo = {
  version: string; detector: string; models: Record<string, string>;
  handRegions?: (HandRegionSettings | LegacyHandRegionSettings) & { enabled: boolean };
  temporal?: TemporalPolicy;
};
export type MotionClip = {
  schema: 'signlingo.motion'; version: 1; language: 'ksl';
  pipeline: PipelineInfo;
  source: { name: string; size: number; duration: number; timeOffset?:number; width: number; height: number; mirrored: boolean; sampleHz: number };
  spaces: { image: string; body: string; hand: string; avatar: string; alignment: string };
  nonmanual: { head: string; face: 'not-estimated'; linguisticValidation: 'not-performed' };
  frames: MotionFrame[]; edits: WristEdit[];
};
// A separate, disposable visualization product. Never a MotionClip or scoring input.
export type EvidenceState = 'observed' | 'interpolated' | 'held' | 'unavailable';
export type HandEvidence = {
  state: EvidenceState;
  position: EvidenceState;
  orientation: EvidenceState;
  fingers: EvidenceState;
  identity: 'reliable' | 'ambiguous' | 'unavailable';
  anchors?: [number, number];
  reason?: string;
};
export type DisplayPose = Pose & { evidence?: Record<Side, HandEvidence> };
export type TemporalFrame = { timestamp: number; pose: DisplayPose; assignment: Partial<Record<Side, number>> };
export type TemporalMotion = { algorithm: 'conservative-bidirectional-v1'; frames: TemporalFrame[]; maxGapMs: number; elapsedMs: number };
export const SIDES: Side[] = ['left', 'right'];
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
/**
 * Default extraction pipeline. Hand-region re-detection (0.3.x, plus the learner temporal policy) is an opt-in
 * experiment: 0.3.0 did not reduce missing hands on the private real-video evaluation; 0.3.1 only fills gaps.
 */
export const PIPELINE_VERSION = '0.2.0';
export const MODELS = {
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm',
};
export const SPACES: MotionClip['spaces'] = {
  image: 'Normalized unmirrored inference pixels: +x right, +y down; original display is mirrored back if requested.',
  body: 'MediaPipe estimated world meters, hip origin, camera-oriented axes. Not calibrated ground truth.',
  hand: 'MediaPipe estimated hand-centered meters; stored separately, NEVER added directly to body coordinates.',
  avatar: 'Right-handed approximate meters; +x screen right, +y up, +z toward camera. Torso center at y=1.30.',
  alignment: 'C=diag(1,-1,-1). Body centered on shoulder midpoint, scale to 0.38m shoulder span. Hand: C*(h_i-h_0), palm basis from MCPs, attached to IK wrist; fixed finger lengths.',
};
