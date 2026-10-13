/**
 * Learning-path state (v2). Stored separately from `signlingo.lessons.progress.v1`, which keeps its
 * viewed/attempt/history records unchanged. Only completion dates, review boxes and counts are
 * stored: never video, landmarks or motion data.
 */
export const LEARN_KEY = 'signlingo.learn.v2';
export type Box = 1 | 2 | 3 | 4 | 5;
export type NodeRecord = { completedAt: string; runs: number };
export type ReviewRecord = { box: Box; due: string; seen: number; correct: number; wrong: number };
export type LearnStore = { version: 2; nodes: Record<string, NodeRecord>; expressions: Record<string, ReviewRecord>; settings: { sound: boolean } };

const LIMITS = { nodes: 1000, expressions: 2000, key: 4096, count: 1_000_000 };
// Node IDs come from path.ts nodeId(); expression keys from progressKey().
const NODE_KEY = /^(lesson|review):[a-z][a-z0-9-]*:[a-z0-9@:+-]+$/;
const EXPRESSION_KEY = /^[a-z][a-z0-9-]*@[1-9][0-9]*:([a-f0-9]{64}|unpublished)$/;

export function emptyStore(): LearnStore {
  return { version: 2, nodes: Object.create(null), expressions: Object.create(null), settings: { sound: true } };
}
const isDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isCount = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= LIMITS.count;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Accepts only well-formed entries. Anything damaged is dropped instead of breaking learning. */
export function parseLearnStore(value: unknown): LearnStore {
  const store = emptyStore();
  if (!isRecord(value) || value.version !== 2) return store;
  if (isRecord(value.nodes)) {
    for (const [key, node] of Object.entries(value.nodes).slice(0, LIMITS.nodes)) {
      if (key.length > LIMITS.key || !NODE_KEY.test(key) || !isRecord(node) || !isDate(node.completedAt) || !isCount(node.runs, 1)) continue;
      store.nodes[key] = { completedAt: node.completedAt, runs: node.runs };
    }
  }
  if (isRecord(value.expressions)) {
    for (const [key, item] of Object.entries(value.expressions).slice(0, LIMITS.expressions)) {
      if (key.length > LIMITS.key || !EXPRESSION_KEY.test(key) || !isRecord(item) || !isDate(item.due) || !isCount(item.seen) || !isCount(item.correct) || !isCount(item.wrong)) continue;
      if (typeof item.box !== 'number' || ![1, 2, 3, 4, 5].includes(item.box)) continue;
      store.expressions[key] = { box: item.box as Box, due: item.due, seen: item.seen, correct: item.correct, wrong: item.wrong };
    }
  }
  if (isRecord(value.settings) && typeof value.settings.sound === 'boolean') store.settings.sound = value.settings.sound;
  return store;
}
export function readLearnStore(key = LEARN_KEY): LearnStore {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseLearnStore(JSON.parse(raw)) : emptyStore();
  } catch { return emptyStore(); }
}
export function saveLearnStore(store: LearnStore, key = LEARN_KEY) {
  try { window.localStorage.setItem(key, JSON.stringify(store)); } catch { /* Storage may be blocked or full. */ }
}
