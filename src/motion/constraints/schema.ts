import { z } from 'zod';
import { FINGERS } from '../types';
import { DIRECTIONS, FACINGS, POINT_NAMES, pointSide, type PointName } from './names';
import { PRESET_IDS, type PresetId } from './presets';

/**
 * signlingo.constraints v1: post-hoc corrections of a finished 3D motion, written by a person or by an LLM
 * outside the app (docs/CONSTRAINTS.md is the complete reference). Every object is strict, so a misspelled or
 * invented field is an error instead of being silently ignored.
 */
export const CONSTRAINT_FORMAT = 'signlingo.constraints';
const num = z.number().finite();
const unit = num.min(0).max(1);
const int = z.number().int().min(0);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'id는 영어 소문자·숫자·하이픈(최대 64자)입니다.');
const note = z.string().trim().min(1, 'note(한국어 설명)가 필요합니다.').max(500);
const ordered = ([a, b]: readonly [number, number]) => b >= a;
export const spanSchema = z.union([
  z.object({ frames: z.tuple([int, int]).refine(ordered, '프레임 범위는 [시작, 끝] 순서입니다.') }).strict(),
  z.object({ ms: z.tuple([num.min(0), num.min(0)]).refine(ordered, '시간 범위는 [시작, 끝] 순서입니다.') }).strict(),
  z.object({ phase: z.enum(['start', 'middle', 'end', 'whole']) }).strict(),
  z.object({ fraction: z.tuple([unit, unit]).refine(ordered, '비율 범위는 [시작, 끝] 순서입니다.') }).strict(),
], { error: 'span은 {"frames":[a,b]}, {"ms":[a,b]}, {"phase":"start|middle|end|whole"}, {"fraction":[a,b]} 중 하나입니다.' });
const point = z.enum(POINT_NAMES as [PointName, ...PointName[]]);
const hand = z.enum(['left', 'right', 'both']);
const move = z.enum(['both', 'left', 'right']).default('both');
const centimeters = (fallback: number) => num.min(0).max(30).default(fallback);
// Largest wrist move per frame for position constraints: a misplaced span cannot teleport a hand.
const maxShift = num.min(0).max(60).default(15);
const common = { id, span: spanSchema, blendMs: num.min(0).max(1000).default(100), strength: unit.default(1), note };
const offset = num.min(-45).max(45);

export const constraintSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('sameHeight'), points: z.array(point).min(2).max(4), toleranceCm: centimeters(1), move, maxShiftCm: maxShift }).strict(),
  z.object({ ...common, kind: z.literal('contact'), a: point, b: point, gapCm: centimeters(0), toleranceCm: centimeters(1), move, maxShiftCm: maxShift }).strict(),
  z.object({ ...common, kind: z.literal('symmetry'), axis: z.enum(['lateral', 'vertical', 'depth']).default('lateral'),
    lead: z.enum(['both', 'left', 'right']).default('both'), orientation: z.boolean().optional(), toleranceCm: centimeters(1), maxShiftCm: maxShift }).strict(),
  z.object({ ...common, kind: z.literal('handshape'), hand, preset: z.enum(PRESET_IDS as [PresetId, ...PresetId[]]),
    fingers: z.array(z.enum(FINGERS)).min(1).max(5).optional() }).strict(),
  z.object({ ...common, kind: z.literal('palmFacing'), hand, facing: z.enum(FACINGS), pointing: z.enum(DIRECTIONS).optional(),
    toleranceDeg: num.min(0).max(90).default(15) }).strict(),
  z.object({ ...common, kind: z.literal('hold'), hand, parts: z.array(z.enum(['position', 'orientation', 'handshape'])).min(1).max(3).default(['position', 'orientation', 'handshape']),
    reference: z.enum(['mean', 'start', 'end']).default('mean'), maxShiftCm: maxShift }).strict(),
  z.object({ ...common, kind: z.literal('wristOffset'), hand: z.enum(['left', 'right']), degrees: z.tuple([offset, offset, offset]) }).strict(),
], { error: 'kind는 sameHeight, contact, symmetry, handshape, palmFacing, hold, wristOffset 중 하나입니다.' });

export const constraintSetSchema = z.object({
  format: z.literal(CONSTRAINT_FORMAT), version: z.literal(1),
  expression: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/).optional(),
  request: z.string().trim().min(1).max(4000).optional(),
  constraints: z.array(constraintSchema).min(1).max(64),
}).strict().superRefine((set, ctx) => {
  const seen = new Set<string>();
  set.constraints.forEach((c, i) => {
    const issue = (message: string, ...path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path: ['constraints', i, ...path] });
    if (seen.has(c.id)) issue(`같은 id(${c.id})가 두 번 있습니다.`, 'id');
    seen.add(c.id);
    const movable = (points: PointName[], who: 'both' | 'left' | 'right') => points.some(p => { const side = pointSide(p); return side && (who === 'both' || who === side); });
    if (c.kind === 'sameHeight') {
      if (new Set(c.points).size !== c.points.length) issue('points에 같은 점이 두 번 있습니다.', 'points');
      if (!movable(c.points, c.move)) issue('move로 움직일 수 있는 손 점이 하나 이상 있어야 합니다(몸 점은 고정 기준입니다).', 'points');
    }
    if (c.kind === 'contact') {
      if (c.a === c.b) issue('a와 b가 같은 점입니다.', 'b');
      if (!movable([c.a, c.b], c.move)) issue('move로 움직일 수 있는 손 점이 a나 b에 있어야 합니다.', 'move');
      if (pointSide(c.a) && pointSide(c.a) === pointSide(c.b)) issue('a와 b가 같은 손의 점이면 손을 옮겨도 거리가 바뀌지 않습니다. handshape를 쓰세요.', 'b');
    }
    if (c.kind === 'symmetry' && c.orientation && c.axis !== 'lateral') issue('orientation(손 방향 거울)은 axis가 lateral일 때만 씁니다.', 'orientation');
    if (c.kind === 'handshape' && c.fingers && new Set(c.fingers).size !== c.fingers.length) issue('fingers에 같은 손가락이 두 번 있습니다.', 'fingers');
  });
});
export type ConstraintSet = z.output<typeof constraintSetSchema>;
export type ConstraintInput = z.input<typeof constraintSetSchema>;
export type Constraint = ConstraintSet['constraints'][number];
export type ConstraintKind = Constraint['kind'];
export type Span = z.output<typeof spanSchema>;

/** Validates a document (text or parsed JSON) and fills defaults. Errors name the JSON path of each problem. */
export function parseConstraints(input: string | unknown): ConstraintSet {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch (error) { throw new Error(`제약 조건 JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const result = constraintSetSchema.safeParse(value);
  if (result.success) return result.data;
  const lines = result.error.issues.slice(0, 8).map(issue => `${issue.path.length ? issue.path.map(p => typeof p === 'number' ? `[${p}]` : `.${String(p)}`).join('').replace(/^\./, '') : '(문서)'}: ${issue.message}`);
  throw new Error(`제약 조건 JSON 오류\n${lines.join('\n')}`);
}
export const exportConstraints = (set: ConstraintSet) => JSON.stringify(set, null, 2) + '\n';
