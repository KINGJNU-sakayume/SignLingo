import { FINGERS, SIDES, type Side } from '../types';

/**
 * Names a constraint document may use. Fingers are anatomical (thumb … pinky) everywhere in code and JSON;
 * the Korean dictionary's numbered-finger notation is translated only in docs/CONSTRAINTS.md.
 */
export type Finger = typeof FINGERS[number];
export const HAND_SITES = ['wrist', 'palm', 'back', 'pinkyEdge', 'indexEdge'] as const;
export const FINGER_SITES = ['base', 'mid', 'tip'] as const;
export type HandSite = typeof HAND_SITES[number];
export type FingerSite = typeof FINGER_SITES[number];
export const BODY_POINTS = ['head.forehead', 'head.nose', 'head.mouth', 'head.chin', 'head.left', 'head.right',
  'body.chest', 'body.belly', 'body.leftShoulder', 'body.rightShoulder'] as const;
export type BodyPoint = typeof BODY_POINTS[number];
export type HandPoint = `${Side}.${HandSite}` | `${Side}.${Finger}.${FingerSite}`;
export type PointName = HandPoint | BodyPoint;
export const HAND_POINTS = SIDES.flatMap(side => [...HAND_SITES.map(site => `${side}.${site}`),
  ...FINGERS.flatMap(finger => FINGER_SITES.map(site => `${side}.${finger}.${site}`))]) as HandPoint[];
export const POINT_NAMES: readonly PointName[] = [...HAND_POINTS, ...BODY_POINTS];

/** Directions in the signer's torso frame: left/right are the signer's own, forward is away from the chest. */
export const DIRECTIONS = ['up', 'down', 'forward', 'back', 'left', 'right', 'inward', 'outward'] as const;
export type Direction = typeof DIRECTIONS[number];
export const FACINGS = [...DIRECTIONS, 'other-hand'] as const;
export type Facing = typeof FACINGS[number];

export const pointSide = (name: PointName): Side | null => name.startsWith('left.') ? 'left' : name.startsWith('right.') ? 'right' : null;

/** Korean labels for the Motion Lab panel. */
export const FINGER_LABELS: Record<Finger, string> = { thumb: '엄지', index: '검지', middle: '중지', ring: '약지', pinky: '새끼' };
const SIDE_LABELS: Record<Side, string> = { left: '왼손', right: '오른손' };
const SITE_LABELS: Record<HandSite | FingerSite, string> = {
  wrist: '손목', palm: '손바닥 가운데', back: '손등 가운데', pinkyEdge: '새끼 쪽 손날', indexEdge: '검지 쪽 옆면',
  base: '뿌리 마디', mid: '가운데 마디', tip: '끝',
};
const BODY_LABELS: Record<BodyPoint, string> = {
  'head.forehead': '이마', 'head.nose': '코', 'head.mouth': '입', 'head.chin': '턱', 'head.left': '머리 왼쪽', 'head.right': '머리 오른쪽',
  'body.chest': '가슴', 'body.belly': '배', 'body.leftShoulder': '왼어깨', 'body.rightShoulder': '오른어깨',
};
export function pointLabel(name: PointName): string {
  if (name in BODY_LABELS) return BODY_LABELS[name as BodyPoint];
  const [side, a, b] = name.split('.');
  return b ? `${SIDE_LABELS[side as Side]} ${FINGER_LABELS[a as Finger]} ${SITE_LABELS[b as FingerSite]}` : `${SIDE_LABELS[side as Side]} ${SITE_LABELS[a as HandSite]}`;
}
export const DIRECTION_LABELS: Record<Facing, string> = {
  up: '위', down: '아래', forward: '앞(몸 바깥)', back: '뒤(몸 쪽)', left: '수어자의 왼쪽', right: '수어자의 오른쪽',
  inward: '몸 중심 쪽', outward: '몸 바깥쪽(옆)', 'other-hand': '다른 손 쪽',
};
export const KIND_LABELS = { sameHeight: '같은 높이', contact: '접촉', symmetry: '대칭', handshape: '손 모양', palmFacing: '손바닥 방향', hold: '자세 유지', wristOffset: '손목 회전' } as const;
export const PHASE_LABELS = { start: '시작', middle: '중간', end: '끝', whole: '전체' } as const;
/** How a span reads in the panel and reports. Phase and fraction spans are relative to the signing interval. */
export function spanLabel(span: { frames: [number, number] } | { ms: [number, number] } | { phase: keyof typeof PHASE_LABELS } | { fraction: [number, number] }): string {
  if ('frames' in span) return `프레임 ${span.frames[0]}–${span.frames[1]}`;
  if ('ms' in span) return `${(span.ms[0] / 1000).toFixed(2)}–${(span.ms[1] / 1000).toFixed(2)}초`;
  if ('phase' in span) return `수어 구간 ${PHASE_LABELS[span.phase]}`;
  return `수어 구간 ${Math.round(span.fraction[0] * 100)}–${Math.round(span.fraction[1] * 100)}%`;
}
