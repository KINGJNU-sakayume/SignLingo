import { Quaternion } from 'three';
import { eulerQuat, rad } from '../math';
import { FINGERS, type Side } from '../types';
import type { Finger } from './names';

/** One finger joint as [flexion, spread] in degrees. Flexion bends toward the palm; positive spread leans toward the thumb side. */
export type PresetJoint = readonly [number, number];
export type HandshapePreset = { label: string; description: string; fingers: Record<Finger, readonly [PresetJoint, PresetJoint, PresetJoint]> };

// Shared finger postures. Values are avatar-rig rotations (same parameterization as reconstructFingers:
// Rx(flex)·Rz(spread) per joint), chosen by the geometric checks in tests/constraints.test.ts.
const STRAIGHT = [[0, 0], [0, 0], [0, 0]] as const;
const CURLED = [[85, 0], [95, 0], [60, 0]] as const;
const THUMB_ALONGSIDE = [[0, 12], [5, 0], [5, 0]] as const;
const THUMB_ACROSS = [[0, -26], [52, 0], [60, 0]] as const;

/**
 * Handshape presets as finger joint rotation tables, defined for the LEFT hand. The right hand uses the mirror
 * image (spread negated), exactly as the rig mirrors finger offsets. Names are anatomical only.
 */
export const HANDSHAPES = {
  fist: { label: '주먹', description: '네 손가락을 모두 접고 엄지를 접은 손가락 위에 댄다.',
    fingers: { thumb: THUMB_ACROSS, index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED } },
  flat: { label: '편손', description: '다섯 손가락을 모두 펴서 붙인다. 엄지는 검지 옆에 붙인다.',
    fingers: { thumb: THUMB_ALONGSIDE, index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT } },
  spread: { label: '편 손가락 벌리기', description: '다섯 손가락을 모두 펴서 벌린다.',
    fingers: { thumb: [[12, 45], [8, 0], [5, 0]], index: [[0, 10], [0, 0], [0, 0]], middle: STRAIGHT, ring: [[0, -9], [0, 0], [0, 0]], pinky: [[0, -18], [0, 0], [0, 0]] } },
  bent: { label: '꺾은 편손', description: '네 손가락을 붙인 채 뿌리 마디에서만 직각으로 꺾는다. 엄지는 검지 옆에 붙인다.',
    fingers: { thumb: THUMB_ALONGSIDE, index: [[85, 0], [0, 0], [0, 0]], middle: [[85, 0], [0, 0], [0, 0]], ring: [[85, 0], [0, 0], [0, 0]], pinky: [[85, 0], [0, 0], [0, 0]] } },
  index: { label: '검지 펴기', description: '주먹에서 검지만 곧게 편다.',
    fingers: { thumb: THUMB_ACROSS, index: STRAIGHT, middle: CURLED, ring: CURLED, pinky: CURLED } },
  'index-middle': { label: '검지·중지 펴기', description: '주먹에서 검지와 중지를 펴서 조금 벌린다.',
    fingers: { thumb: THUMB_ACROSS, index: [[0, 8], [0, 0], [0, 0]], middle: [[0, -6], [0, 0], [0, 0]], ring: CURLED, pinky: CURLED } },
  thumb: { label: '엄지 펴기', description: '주먹에서 엄지만 곧게 세운다.',
    fingers: { thumb: [[0, 22], [0, 0], [0, 0]], index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED } },
  pinky: { label: '새끼 펴기', description: '주먹에서 새끼손가락만 곧게 편다.',
    fingers: { thumb: THUMB_ACROSS, index: CURLED, middle: CURLED, ring: CURLED, pinky: STRAIGHT } },
  'index-thumb-circle': { label: '검지·엄지 동그라미', description: '검지 끝과 엄지 끝을 맞대어 동그라미를 만들고 나머지 손가락은 편다.',
    fingers: { thumb: [[36, 0], [12, 0], [10, 0]], index: [[45, 0], [60, 0], [40, 0]], middle: [[0, -2], [0, 0], [0, 0]], ring: [[0, -8], [0, 0], [0, 0]], pinky: [[0, -14], [0, 0], [0, 0]] } },
} as const satisfies Record<string, HandshapePreset>;
export type PresetId = keyof typeof HANDSHAPES;
export const PRESET_IDS = Object.keys(HANDSHAPES) as PresetId[];

/** Finger joint rotations (`${side}.${finger}.${j}`) of a preset for one hand, optionally only some fingers. */
export function presetRotations(id: PresetId, side: Side, fingers: readonly Finger[] = FINGERS): Record<string, Quaternion> {
  const out: Record<string, Quaternion> = {}, mirror = side === 'right' ? -1 : 1;
  for (const finger of fingers) HANDSHAPES[id].fingers[finger].forEach(([flex, spread], j) => {
    out[`${side}.${finger}.${j}`] = eulerQuat(rad(flex), 0, rad(spread * mirror));
  });
  return out;
}
