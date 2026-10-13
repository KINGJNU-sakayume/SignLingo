import type { Catalog, Expression } from '../content/schema';
import { progressKey } from '../lessons/catalog';
import { shuffle, type Rng } from './rng';
import { scheduleReview } from './review';
import { similarExpressions } from './similarity';
import type { LearnStore } from './storage';

/**
 * ① intro: watch a new expression (no grading)
 * ② pick-meaning: watch the sign, choose its Korean equivalent
 * ③ pick-sign: read the Korean equivalent, play options in the shared viewer, choose the sign
 * ④ same-different: watch two demonstrations, decide whether they are the same sign
 * ⑤ camera: imitate with Practice Mode; observed differences only, never graded
 * Every option comes from a real published expression; nothing is invented.
 */
export type Step =
  | { id: string; kind: 'intro'; target: string }
  | { id: string; kind: 'pick-meaning'; target: string; options: string[] }
  | { id: string; kind: 'pick-sign'; target: string; options: string[] }
  | { id: string; kind: 'same-different'; target: string; other: string; same: boolean }
  | { id: string; kind: 'camera'; target: string };
export type GradedStep = Extract<Step, { kind: 'pick-meaning' | 'pick-sign' | 'same-different' }>;
export type Plan = {
  kind: 'lesson' | 'review'; nodeId: string | null; unitId: string | null;
  /** Expressions taught (lesson) or reviewed (review); the subject of review scheduling. */
  targets: string[]; steps: Step[];
};
export type CameraResult = { stepId: string; evidence: 'sufficient' | 'limited'; feedback: string[] };
export type SessionState = {
  plan: Plan; queue: string[]; completed: string[];
  /** First answer to each graded step; requeued retries never overwrite it. */
  firstTry: Record<string, boolean>; mistakes: number;
  /** Option order per step. Reshuffled when a missed question returns. */
  order: Record<string, string[]>;
  cameraSkipped: boolean; cameraResults: CameraResult[]; startedAt: number;
};

export const MIN_STEPS = 8, MAX_STEPS = 12;
export const isGraded = (step: Step): step is GradedStep => step.kind === 'pick-meaning' || step.kind === 'pick-sign' || step.kind === 'same-different';

/** Other published expressions that may serve as wrong options for target, same unit first. */
export function distractorPool(target: Expression, catalog: Catalog): Expression[] {
  const others = catalog.expressions.filter(entry => !similarExpressions(entry, target));
  return [...others.filter(entry => entry.lessonId === target.lessonId), ...others.filter(entry => entry.lessonId !== target.lessonId)];
}
/** Target plus up to count−1 distractors that are pairwise dissimilar. Null when no valid option exists. */
export function pickOptions(target: Expression, catalog: Catalog, count: number, rng: Rng): string[] | null {
  const pool = distractorPool(target, catalog), sameUnit = pool.filter(e => e.lessonId === target.lessonId);
  const ordered = [...shuffle(sameUnit, rng), ...shuffle(pool.filter(e => e.lessonId !== target.lessonId), rng)];
  const chosen: Expression[] = [];
  for (const candidate of ordered) {
    if (chosen.length >= count - 1) break;
    if (chosen.every(other => !similarExpressions(other, candidate))) chosen.push(candidate);
  }
  return chosen.length ? shuffle([target.id, ...chosen.map(e => e.id)], rng) : null;
}

class StepFactory {
  private count = 0;
  constructor(private catalog: Catalog, private rng: Rng) {}
  private id(kind: Step['kind'], target: string) { return `${++this.count}-${kind}-${target}`; }
  intro(target: Expression): Step { return { id: this.id('intro', target.id), kind: 'intro', target: target.id }; }
  camera(target: Expression): Step { return { id: this.id('camera', target.id), kind: 'camera', target: target.id }; }
  pickMeaning(target: Expression, count: number): Step | null {
    const options = pickOptions(target, this.catalog, count, this.rng);
    return options && { id: this.id('pick-meaning', target.id), kind: 'pick-meaning', target: target.id, options };
  }
  pickSign(target: Expression, count: number): Step | null {
    const options = pickOptions(target, this.catalog, count, this.rng);
    return options && { id: this.id('pick-sign', target.id), kind: 'pick-sign', target: target.id, options };
  }
  sameDifferent(target: Expression, same: boolean): Step | null {
    const other = same ? [target.id] : pickOptions(target, this.catalog, 2, this.rng)?.filter(id => id !== target.id);
    return other?.length ? { id: this.id('same-different', target.id), kind: 'same-different', target: target.id, other: other[0], same } : null;
  }
}
const present = <T>(value: T | null): value is T => value !== null;

/**
 * Builds an 8–12 step lesson: each new expression is introduced and checked with an easy
 * two-option question, practice gets harder (③ → ④ → four-option ②), one camera step follows,
 * and the lesson ends on an easy question. Without a valid wrong option only ① and ⑤ are used.
 */
export function buildLessonSession(nodeId: string | null, targets: readonly Expression[], catalog: Catalog, rng: Rng): Plan {
  const make = new StepFactory(catalog, rng);
  const order = shuffle(targets, rng);
  const quizzable = order.filter(target => distractorPool(target, catalog).length > 0);
  const opening: Step[] = [];
  for (const target of targets) {
    opening.push(make.intro(target));
    if (quizzable.includes(target)) { const check = make.pickMeaning(target, 2); if (check) opening.push(check); }
  }
  const cameraTarget = targets.find(target => target.difficulty.cameraSuitability === 'suitable');
  const closing = quizzable.length ? make.pickMeaning(quizzable[0], 2) : null;
  const fixed = opening.length + (cameraTarget ? 1 : 0) + (closing ? 1 : 0);
  const firstSame = rng() < .5;
  const middle = [
    ...quizzable.map(target => make.pickSign(target, 3)),
    ...quizzable.map((target, i) => make.sameDifferent(target, (i % 2 === 0) === firstSame)),
    ...quizzable.map(target => make.pickMeaning(target, 4)),
  ].filter(present).slice(0, Math.max(0, MAX_STEPS - fixed));
  // A single new expression is too short for practice; add its opposite same/different check.
  for (const [i, target] of quizzable.entries()) {
    if (fixed + middle.length >= MIN_STEPS) break;
    const extra = make.sameDifferent(target, (i % 2 === 0) !== firstSame); if (extra) middle.push(extra);
  }
  return { kind: 'lesson', nodeId, unitId: targets[0]?.lessonId ?? null, targets: targets.map(t => t.id),
    steps: [...opening, ...middle, ...(cameraTarget ? [make.camera(cameraTarget)] : []), ...(closing ? [closing] : [])] };
}
/** Short recognition-only review (②③④), 6–8 questions, ending on an easy one. */
export function buildReviewSession(nodeId: string | null, targets: readonly Expression[], catalog: Catalog, rng: Rng): Plan {
  const make = new StepFactory(catalog, rng);
  const quizzable = shuffle(targets, rng).filter(target => distractorPool(target, catalog).length > 0);
  const base = { kind: 'review' as const, nodeId, unitId: targets[0]?.lessonId ?? null, targets: targets.map(t => t.id) };
  if (!quizzable.length) return { ...base, steps: targets.map(target => make.intro(target)) };
  const count = Math.min(8, Math.max(6, quizzable.length * 2));
  const steps: Step[] = [];
  for (let i = 0; steps.length < count - 1 && i < count * 3; i++) {
    const target = quizzable[i % quizzable.length], round = Math.floor(i / quizzable.length);
    const step = [() => make.pickMeaning(target, 4), () => make.pickSign(target, 3), () => make.sameDifferent(target, (i + round) % 2 === 0)][(i + round) % 3]();
    if (step) steps.push(step);
  }
  const closing = make.pickMeaning(quizzable[0], 2);
  return { ...base, steps: closing ? [...steps, closing] : steps };
}

export function gradeAnswer(step: Step, answer: string): boolean {
  if (step.kind === 'pick-meaning' || step.kind === 'pick-sign') return answer === step.target;
  if (step.kind === 'same-different') return (answer === 'same') === step.same;
  return true;
}
/** A missed question goes to the end of the queue and must be answered again. */
export function requeueWrong(queue: readonly string[], stepId: string): string[] {
  return [...queue.filter(id => id !== stepId), stepId];
}

export function startSession(plan: Plan, now = Date.now()): SessionState {
  const order: Record<string, string[]> = {};
  for (const step of plan.steps) if (step.kind === 'pick-meaning' || step.kind === 'pick-sign') order[step.id] = step.options;
  return { plan, queue: plan.steps.map(s => s.id), completed: [], firstTry: {}, mistakes: 0, order, cameraSkipped: false, cameraResults: [], startedAt: now };
}
export function currentStep(state: SessionState): Step | null {
  return state.plan.steps.find(step => step.id === state.queue[0]) ?? null;
}
/** Records an answer after the learner continues past the feedback sheet. */
export function recordAnswer(state: SessionState, stepId: string, correct: boolean, rng: Rng): SessionState {
  const step = state.plan.steps.find(s => s.id === stepId);
  if (!step || state.queue[0] !== stepId) return state;
  const firstTry = stepId in state.firstTry ? state.firstTry : { ...state.firstTry, [stepId]: correct };
  if (correct) return { ...state, firstTry, queue: state.queue.slice(1), completed: [...state.completed, stepId] };
  const order = state.order[stepId] ? { ...state.order, [stepId]: shuffle(state.order[stepId], rng) } : state.order;
  return { ...state, firstTry, order, mistakes: state.mistakes + 1, queue: requeueWrong(state.queue, stepId) };
}
export function completeStep(state: SessionState, stepId: string, camera?: Omit<CameraResult, 'stepId'>): SessionState {
  if (state.queue[0] !== stepId) return state;
  return { ...state, queue: state.queue.slice(1), completed: [...state.completed, stepId], cameraResults: camera ? [...state.cameraResults, { stepId, ...camera }] : state.cameraResults };
}
/** "지금은 카메라를 쓸 수 없어요": drop every remaining camera step from this session. */
export function skipCamera(state: SessionState): SessionState {
  const camera = new Set(state.plan.steps.filter(s => s.kind === 'camera').map(s => s.id));
  return { ...state, cameraSkipped: true, queue: state.queue.filter(id => !camera.has(id)) };
}
export function sessionProgress(state: SessionState) {
  const skipped = state.cameraSkipped ? state.plan.steps.filter(s => s.kind === 'camera' && !state.completed.includes(s.id)).length : 0;
  return { done: state.completed.length, total: state.plan.steps.length - skipped };
}
export function isFinished(state: SessionState) { return state.queue.length === 0; }
export function sessionSummary(state: SessionState, now = Date.now()) {
  const graded = state.plan.steps.filter(isGraded);
  return {
    graded: graded.length, firstTryCorrect: graded.filter(s => state.firstTry[s.id]).length,
    durationMs: Math.max(0, now - state.startedAt), newExpressions: state.plan.kind === 'lesson' ? state.plan.targets.length : 0,
    reviewed: state.plan.kind === 'review' ? state.plan.targets.length : 0, cameraAttempts: state.cameraResults.length,
  };
}
/** Per-expression outcome: any first-try mistake counts as wrong. Expressions without questions are absent. */
export function expressionOutcomes(state: SessionState): Record<string, 'correct' | 'wrong'> {
  const result: Record<string, 'correct' | 'wrong'> = {};
  for (const step of state.plan.steps.filter(isGraded)) {
    if (!state.plan.targets.includes(step.target) || !(step.id in state.firstTry)) continue;
    result[step.target] = state.firstTry[step.id] && result[step.target] !== 'wrong' ? 'correct' : 'wrong';
  }
  return result;
}
/** Applies a finished session to the v2 store: node completion and Leitner boxes. */
export function applySession(store: LearnStore, state: SessionState, catalog: Catalog, now = new Date()): LearnStore {
  const nodes = Object.assign(Object.create(null), store.nodes) as LearnStore['nodes'];
  const expressions = Object.assign(Object.create(null), store.expressions) as LearnStore['expressions'];
  if (state.plan.nodeId) nodes[state.plan.nodeId] = { completedAt: now.toISOString(), runs: (store.nodes[state.plan.nodeId]?.runs ?? 0) + 1 };
  const outcomes = expressionOutcomes(state);
  for (const id of state.plan.targets) {
    const entry = catalog.expressions.find(e => e.id === id); if (!entry) continue;
    const key = progressKey(entry), outcome = outcomes[id];
    if (outcome) expressions[key] = scheduleReview(store.expressions[key], outcome, now);
    // Watched in a lesson without a valid question: start the schedule without promoting it.
    else if (state.plan.kind === 'lesson' && !store.expressions[key]) expressions[key] = scheduleReview(undefined, 'correct', now);
  }
  return { ...store, nodes, expressions };
}
