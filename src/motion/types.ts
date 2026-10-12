export type Side = 'left' | 'right';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Landmark = { x: number; y: number; z: number; visibility?: number; presence?: number };
export type HandDetection = { image: Landmark[]; world: Landmark[]; label: string; score: number };
export type Detection = { timestamp: number; body: Landmark[]; bodyWorld: Landmark[]; hands: HandDetection[] };
export type TrackingState = 'tracked' | 'held' | 'missing';
export type Quality = { body: number; left: number; right: number; leftArm: number; rightArm: number; leftState: TrackingState; rightState: TrackingState };
export type Correction = { joint: string; kind: string; amount: number };
export type Pose = { root: Vec3; rotations: Record<string, Quat>; quality: Quality };
export type MotionFrame = Detection & { pose: Pose; warnings: string[]; corrections: Correction[]; assignment: Partial<Record<Side, number>> };
export type WristEdit = { frame: number; side: Side; degrees: Vec3 };
export type MotionClip = {
  schema: 'signlingo.motion'; version: 1; language: 'ksl';
  pipeline: { version: string; detector: string; models: Record<string, string> };
  source: { name: string; size: number; duration: number; width: number; height: number; mirrored: boolean; sampleHz: number };
  spaces: { image: string; body: string; hand: string; avatar: string; alignment: string };
  nonmanual: { head: string; face: 'not-estimated'; linguisticValidation: 'not-performed' };
  frames: MotionFrame[]; edits: WristEdit[];
};
export const SIDES: Side[] = ['left', 'right'];
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
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
