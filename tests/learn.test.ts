import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../public/content/manifest.json' with { type: 'json' };
import { parseCatalog } from '../src/content/validation';
import { progressKey } from '../src/lessons/catalog';
import { buildPath, groupSizes, NODE_OFFSETS } from '../src/learn/path';
import { BOX_DAYS, dueExpressions, nextReviewDate, relativeDay, scheduleReview } from '../src/learn/review';
import { seededRng } from '../src/learn/rng';
import {
  applySession, buildLessonSession, buildReviewSession, completeStep, currentStep, expressionOutcomes, gradeAnswer, isFinished,
  isGraded, MAX_STEPS, MIN_STEPS, pickOptions, recordAnswer, requeueWrong, sessionProgress, sessionSummary, skipCamera, startSession, type Step,
} from '../src/learn/session';
import { koreanStems, similarExpressions } from '../src/learn/similarity';
import { emptyStore, LEARN_KEY, parseLearnStore, readLearnStore, saveLearnStore } from '../src/learn/storage';
import { learnCatalog, learnEntry } from './learn-fixtures';

afterEach(() => vi.unstubAllGlobals());
const NOW = new Date('2026-10-13T09:00:00Z');
const DAY = 86_400_000;
const ids = (steps: Step[]) => steps.flatMap(step => 'options' in step ? step.options : step.kind === 'same-different' ? [step.target, step.other] : [step.target]);

describe('learning path', () => {
  it('groups new expressions into lessons of two or three', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 10].map(groupSizes)).toEqual([[], [1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2], [3, 3, 2, 2]]);
  });
  it('shows five coming-soon units and nothing playable for the deployed manifest', () => {
    const path = buildPath(parseCatalog(manifest), emptyStore(), NOW);
    expect(path.hasContent).toBe(false); expect(path.current).toBeNull();
    expect(path.units).toHaveLength(5);
    expect(path.units.every(unit => unit.soon && unit.nodes.length === 3 && unit.nodes.every(node => node.state === 'coming-soon' && node.kind === 'soon'))).toBe(true);
  });
  it('unlocks one node at a time and skips units without published expressions', () => {
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry', 'ksl-what']);
    let path = buildPath(catalog, emptyStore(), NOW);
    const [courtesy, responses, questions] = path.units;
    expect(courtesy.nodes.map(n => [n.kind, n.state])).toEqual([['lesson', 'current'], ['review', 'locked'], ['trophy', 'locked']]);
    expect(courtesy.nodes.map(n => n.offset)).toEqual(NODE_OFFSETS.slice(0, 3));
    expect(responses.soon).toBe(true); expect(questions.nodes[0].state).toBe('locked');
    const store = emptyStore();
    store.nodes[courtesy.nodes[0].id] = { completedAt: NOW.toISOString(), runs: 1 };
    store.nodes[courtesy.nodes[1].id] = { completedAt: NOW.toISOString(), runs: 1 };
    path = buildPath(catalog, store, NOW);
    expect(path.units[0].completed).toBe(true); expect(path.units[0].nodes[2].state).toBe('completed');
    expect(path.current?.id).toBe(path.units[2].nodes[0].id);
  });
  it('marks a completed lesson for review when its expressions are due', () => {
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry']);
    const store = emptyStore(), lesson = buildPath(catalog, store, NOW).units[0].nodes[0];
    store.nodes[lesson.id] = { completedAt: NOW.toISOString(), runs: 1 };
    store.expressions[progressKey(catalog.expressions[0])] = { box: 1, due: new Date(NOW.getTime() - 1).toISOString(), seen: 1, correct: 1, wrong: 0 };
    expect(buildPath(catalog, store, NOW).units[0].nodes[0].state).toBe('review-due');
  });
  it('does not carry completion to a new content revision', () => {
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry']), store = emptyStore();
    const lesson = buildPath(catalog, store, NOW).units[0].nodes[0];
    store.nodes[lesson.id] = { completedAt: NOW.toISOString(), runs: 1 };
    catalog.expressions[1] = { ...catalog.expressions[1], revision: 2 };
    const revised = buildPath(catalog, store, NOW).units[0].nodes[0];
    expect(revised.id).not.toBe(lesson.id); expect(revised.state).toBe('current');
  });
});

describe('question options', () => {
  it('splits Korean equivalents into comparable stems', () => {
    expect(koreanStems('아니다, 아니, 부인(하다)')).toEqual(expect.arrayContaining(['아니다', '아니', '부인', '부인하다']));
    expect(koreanStems('(물건이나 돈이) 없다')).toContain('없다');
  });
  it('treats overlapping or multi-sense equivalents as similar', () => {
    const absent = learnEntry('ksl-absent'), money = learnEntry('ksl-absent-money', { displayName: '(물건이나 돈이) 없다', source: { ...absent.source, entryId: 'other' } });
    expect(similarExpressions(absent, money)).toBe(true);
    expect(similarExpressions(learnEntry('ksl-no'), learnEntry('ksl-no-short', { displayName: '아니', source: { ...absent.source, entryId: 'x' } }))).toBe(true);
    expect(similarExpressions(learnEntry('ksl-thanks'), learnEntry('ksl-sorry'))).toBe(false);
  });
  it('only uses published expressions, includes the answer and never pairs similar options', () => {
    const absent = learnEntry('ksl-absent', {}, 9);
    const money = learnEntry('ksl-absent-money', { displayName: '(물건이나 돈이) 없다', lessonId: 'responses', source: { ...absent.source, entryId: 'pilot-money' } }, 10);
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry', 'ksl-okay', 'ksl-no'], [absent, money]);
    const known = new Set(catalog.expressions.map(e => e.id));
    for (let seed = 1; seed < 40; seed++) {
      const target = catalog.expressions[seed % catalog.expressions.length];
      const options = pickOptions(target, catalog, 4, seededRng(seed))!;
      expect(options).toContain(target.id);
      expect(options.length).toBeGreaterThanOrEqual(2); expect(options.length).toBeLessThanOrEqual(4);
      expect(options.every(id => known.has(id))).toBe(true);
      const entries = options.map(id => catalog.expressions.find(e => e.id === id)!);
      for (const [i, a] of entries.entries()) for (const b of entries.slice(i + 1)) expect(similarExpressions(a, b)).toBe(false);
    }
  });
  it('builds no recognition question when fewer than two options exist', () => {
    const catalog = learnCatalog(['ksl-thanks']);
    expect(pickOptions(catalog.expressions[0], catalog, 4, seededRng(1))).toBeNull();
    const plan = buildLessonSession('n', catalog.expressions, catalog, seededRng(1));
    expect(plan.steps.map(s => s.kind)).toEqual(['intro', 'camera']);
  });
});

describe('lesson sessions', () => {
  const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry', 'ksl-meet', 'ksl-okay', 'ksl-no', 'ksl-what']);
  it.each([1, 2, 3])('composes %i new expressions into 8–12 steps that start and end easy', count => {
    const targets = catalog.expressions.slice(0, count);
    for (let seed = 1; seed < 20; seed++) {
      const plan = buildLessonSession('node', targets, catalog, seededRng(seed));
      expect(plan.steps.length).toBeGreaterThanOrEqual(MIN_STEPS); expect(plan.steps.length).toBeLessThanOrEqual(MAX_STEPS);
      expect(plan.steps[0]).toMatchObject({ kind: 'intro', target: targets[0].id });
      const last = plan.steps.at(-1)!;
      expect(last.kind).toBe('pick-meaning'); expect('options' in last && last.options).toHaveLength(2);
      expect(plan.steps.filter(s => s.kind === 'intro').map(s => s.target)).toEqual(targets.map(t => t.id));
      expect(plan.steps.filter(s => s.kind === 'camera')).toHaveLength(1);
      expect(new Set(plan.steps.map(s => s.id)).size).toBe(plan.steps.length);
      expect(ids(plan.steps).every(id => catalog.expressions.some(e => e.id === id))).toBe(true);
      // Every expression is introduced before it is asked about.
      for (const step of plan.steps.filter(isGraded)) expect(plan.steps.findIndex(s => s.kind === 'intro' && s.target === step.target)).toBeLessThan(plan.steps.indexOf(step));
    }
  });
  it('is reproducible with the same seed', () => {
    const a = buildLessonSession('n', catalog.expressions.slice(0, 2), catalog, seededRng(7));
    const b = buildLessonSession('n', catalog.expressions.slice(0, 2), catalog, seededRng(7));
    expect(a).toEqual(b);
  });
  it('adds the camera step only for expressions suitable for camera practice', () => {
    const limited = learnCatalog(['ksl-thanks', 'ksl-sorry']);
    for (const entry of limited.expressions) entry.difficulty.cameraSuitability = 'limited';
    expect(buildLessonSession('n', limited.expressions, limited, seededRng(3)).steps.some(s => s.kind === 'camera')).toBe(false);
  });
  it('grades recognition answers and leaves the camera step ungraded', () => {
    const plan = buildLessonSession('n', catalog.expressions.slice(0, 2), catalog, seededRng(5));
    for (const step of plan.steps) {
      if (step.kind === 'pick-meaning' || step.kind === 'pick-sign') { expect(gradeAnswer(step, step.target)).toBe(true); expect(gradeAnswer(step, step.options.find(o => o !== step.target)!)).toBe(false); }
      if (step.kind === 'same-different') { expect(gradeAnswer(step, step.same ? 'same' : 'different')).toBe(true); expect(gradeAnswer(step, step.same ? 'different' : 'same')).toBe(false); }
      if (step.kind === 'camera') expect(isGraded(step)).toBe(false);
    }
  });
  it('requeues a missed question at the end and fills its progress only when answered correctly', () => {
    expect(requeueWrong(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    const plan = buildLessonSession('n', catalog.expressions.slice(0, 2), catalog, seededRng(11));
    let state = startSession(plan, 0);
    state = completeStep(state, currentStep(state)!.id);
    const question = currentStep(state)!; expect(isGraded(question)).toBe(true);
    state = recordAnswer(state, question.id, false, seededRng(1));
    expect(sessionProgress(state).done).toBe(1); expect(state.queue.at(-1)).toBe(question.id);
    expect(state.order[question.id]?.slice().sort()).toEqual((question as { options: string[] }).options.slice().sort());
    while (state.queue[0] !== question.id) {
      const step = currentStep(state)!;
      state = isGraded(step) ? recordAnswer(state, step.id, true, seededRng(2)) : completeStep(state, step.id);
    }
    const before = sessionProgress(state).done;
    state = recordAnswer(state, question.id, true, seededRng(3));
    expect(sessionProgress(state).done).toBe(before + 1); expect(isFinished(state)).toBe(true);
    expect(state.firstTry[question.id]).toBe(false);
    expect(sessionSummary(state, 192_000)).toMatchObject({ firstTryCorrect: plan.steps.filter(isGraded).length - 1, durationMs: 192_000, newExpressions: 2 });
    expect(expressionOutcomes(state)[question.target]).toBe('wrong');
  });
  it('drops every camera step when the learner cannot use a camera now', () => {
    const plan = buildLessonSession('n', catalog.expressions.slice(0, 2), catalog, seededRng(4));
    const state = skipCamera(startSession(plan));
    expect(state.queue.some(id => id.includes('camera'))).toBe(false);
    expect(sessionProgress(state).total).toBe(plan.steps.length - 1);
  });
  it('builds 6–8 recognition-only review questions ending on an easy one', () => {
    for (const count of [1, 2, 4]) {
      const plan = buildReviewSession(null, catalog.expressions.slice(0, count), catalog, seededRng(count));
      expect(plan.steps.length).toBeGreaterThanOrEqual(6); expect(plan.steps.length).toBeLessThanOrEqual(8);
      expect(plan.steps.every(isGraded)).toBe(true);
      const last = plan.steps.at(-1)!; expect('options' in last && last.options).toHaveLength(2);
    }
  });
});

describe('Leitner review schedule', () => {
  it('starts new expressions in box 1 and spaces correct reviews 1·2·4·7·14 days apart', () => {
    let record = scheduleReview(undefined, 'correct', NOW);
    expect(record).toMatchObject({ box: 1, seen: 1, correct: 1, wrong: 0 });
    expect(Date.parse(record.due) - NOW.getTime()).toBe(DAY);
    const days: number[] = [];
    let now = NOW;
    for (let i = 0; i < 5; i++) {
      now = new Date(Date.parse(record.due));
      record = scheduleReview(record, 'correct', now);
      days.push((Date.parse(record.due) - now.getTime()) / DAY);
    }
    expect(days).toEqual([BOX_DAYS[2], BOX_DAYS[3], BOX_DAYS[4], BOX_DAYS[5], BOX_DAYS[5]]);
    expect(Object.values(BOX_DAYS)).toEqual([1, 2, 4, 7, 14]);
    expect(record.box).toBe(5);
    const missed = scheduleReview(record, 'wrong', now);
    expect(missed).toMatchObject({ box: 1, wrong: 1 }); expect(Date.parse(missed.due) - now.getTime()).toBe(DAY);
  });
  it('does not promote an expression reviewed before it is due', () => {
    const record = { box: 2 as const, due: new Date(NOW.getTime() + DAY).toISOString(), seen: 2, correct: 2, wrong: 0 };
    expect(scheduleReview(record, 'correct', NOW)).toMatchObject({ box: 2, due: record.due, seen: 3, correct: 3 });
  });
  it('lists due expressions oldest first and describes the next review day', () => {
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry', 'ksl-okay']), store = emptyStore();
    const [a, b, c] = catalog.expressions;
    store.expressions[progressKey(a)] = { box: 1, due: new Date(NOW.getTime() - 1000).toISOString(), seen: 1, correct: 1, wrong: 0 };
    store.expressions[progressKey(b)] = { box: 2, due: new Date(NOW.getTime() - 5000).toISOString(), seen: 1, correct: 1, wrong: 0 };
    store.expressions[progressKey(c)] = { box: 3, due: new Date(NOW.getTime() + DAY).toISOString(), seen: 1, correct: 1, wrong: 0 };
    expect(dueExpressions(store, catalog.expressions, NOW).map(e => e.id)).toEqual([b.id, a.id]);
    delete store.expressions[progressKey(a)]; delete store.expressions[progressKey(b)];
    expect(dueExpressions(store, catalog.expressions, NOW)).toEqual([]);
    expect(relativeDay(nextReviewDate(store, catalog.expressions)!, NOW)).toBe('내일');
  });
  it('applies a finished session once per expression and completes its node', () => {
    const catalog = learnCatalog(['ksl-thanks', 'ksl-sorry', 'ksl-okay']);
    const plan = buildLessonSession('lesson:x', catalog.expressions.slice(0, 2), catalog, seededRng(9));
    let state = startSession(plan);
    let missed = false;
    while (!isFinished(state)) {
      const step = currentStep(state)!;
      if (!isGraded(step)) { state = completeStep(state, step.id); continue; }
      const wrong: boolean = !missed && step.target === catalog.expressions[1].id; missed ||= wrong;
      state = recordAnswer(state, step.id, !wrong, seededRng(1));
    }
    const store = applySession(emptyStore(), state, catalog, NOW);
    expect(store.nodes['lesson:x']).toEqual({ completedAt: NOW.toISOString(), runs: 1 });
    expect(store.expressions[progressKey(catalog.expressions[0])]).toMatchObject({ box: 1, correct: 1, wrong: 0 });
    expect(store.expressions[progressKey(catalog.expressions[1])]).toMatchObject({ box: 1, correct: 0, wrong: 1 });
    expect(store.expressions[progressKey(catalog.expressions[2])]).toBeUndefined();
    expect(applySession(store, state, catalog, NOW).nodes['lesson:x'].runs).toBe(2);
  });
});

describe('v2 learning storage', () => {
  function storage() {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } });
    return data;
  }
  const NODE = 'lesson:courtesy:ksl-thanks@1:' + 'a'.repeat(64), KEY = 'ksl-thanks@1:' + 'b'.repeat(64);
  it('round-trips valid state under its own key without touching v1 progress', () => {
    const data = storage(), store = emptyStore();
    store.nodes[NODE] = { completedAt: NOW.toISOString(), runs: 2 };
    store.expressions[KEY] = { box: 3, due: NOW.toISOString(), seen: 4, correct: 3, wrong: 1 };
    store.settings.sound = false;
    saveLearnStore(store);
    expect([...data.keys()]).toEqual([LEARN_KEY]);
    expect(readLearnStore()).toEqual(store);
  });
  it('recovers from damaged or hostile data', () => {
    const data = storage();
    data.set(LEARN_KEY, '{broken'); expect(readLearnStore()).toEqual(emptyStore());
    data.set(LEARN_KEY, JSON.stringify({ version: 1, nodes: { [NODE]: { completedAt: NOW.toISOString(), runs: 1 } } })); expect(readLearnStore()).toEqual(emptyStore());
    const at = NOW.toISOString(), record = (box: unknown, seen: unknown = 1) => ({ box, due: at, seen, correct: 1, wrong: 0 });
    const raw = JSON.stringify({ version: 2, settings: { sound: 'no' },
      nodes: { [NODE]: { completedAt: at, runs: 1 }, 'lesson:courtesy:zero': { completedAt: at, runs: 0 }, 'review:courtesy:date': { completedAt: 'yesterday', runs: 1 },
        ['lesson:courtesy:' + 'x'.repeat(5000)]: { completedAt: at, runs: 1 }, 'not-a-node': { completedAt: at, runs: 1 } },
      expressions: { [KEY]: record(5), ['ksl-a@1:' + 'c'.repeat(64)]: record(6), ['ksl-b@1:' + 'd'.repeat(64)]: record(1, -1),
        ['ksl-c@1:' + 'e'.repeat(64)]: record(1.5), 'ksl-d@0:unpublished': record(1), ['ksl-e@1:' + 'f'.repeat(64)]: [] } }).replace('"not-a-node"', '"__proto__"');
    const restored = parseLearnStore(JSON.parse(raw));
    expect(Object.keys(restored.nodes)).toEqual([NODE]); expect(Object.keys(restored.expressions)).toEqual([KEY]);
    expect(restored.settings.sound).toBe(true);
    expect(({} as Record<string, unknown>).completedAt).toBeUndefined();
  });
  it('bounds the number of stored records', () => {
    const nodes = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`lesson:courtesy:n${i}`, { completedAt: NOW.toISOString(), runs: 1 }]));
    expect(Object.keys(parseLearnStore({ version: 2, nodes }).nodes)).toHaveLength(1000);
  });
  it('keeps working when storage is blocked', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } } });
    expect(readLearnStore()).toEqual(emptyStore()); expect(() => saveLearnStore(emptyStore())).not.toThrow();
  });
});
