import type { Expression } from '../content/schema';
import { progressKey } from '../lessons/catalog';
import type { Box, LearnStore, ReviewRecord } from './storage';

/** Leitner boxes 1–5: the next review comes 1, 2, 4, 7 or 14 days later. */
export const BOX_DAYS: Record<Box, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };
const DAY = 24 * 60 * 60 * 1000;
const addDays = (now: Date, days: number) => new Date(now.getTime() + days * DAY).toISOString();

/**
 * Applied once per expression per session, only from recognition questions (②③④).
 * A correct review moves the card up a box only when it was due, so repeating a lesson
 * the same day does not inflate the schedule. Any mistake sends it back to box 1.
 */
export function scheduleReview(record: ReviewRecord | undefined, result: 'correct' | 'wrong', now: Date): ReviewRecord {
  const counts = { seen: (record?.seen ?? 0) + 1, correct: (record?.correct ?? 0) + (result === 'correct' ? 1 : 0), wrong: (record?.wrong ?? 0) + (result === 'wrong' ? 1 : 0) };
  if (!record || result === 'wrong') return { box: 1, due: addDays(now, BOX_DAYS[1]), ...counts };
  if (Date.parse(record.due) > now.getTime()) return { ...record, ...counts };
  const box = Math.min(5, record.box + 1) as Box;
  return { box, due: addDays(now, BOX_DAYS[box]), ...counts };
}
/** Expressions learned before whose review date has arrived, oldest first. */
export function dueExpressions(store: LearnStore, expressions: readonly Expression[], now: Date): Expression[] {
  return expressions
    .filter(entry => { const record = store.expressions[progressKey(entry)]; return !!record && Date.parse(record.due) <= now.getTime(); })
    .sort((a, b) => Date.parse(store.expressions[progressKey(a)].due) - Date.parse(store.expressions[progressKey(b)].due));
}
export function learnedExpressions(store: LearnStore, expressions: readonly Expression[]): Expression[] {
  return expressions.filter(entry => !!store.expressions[progressKey(entry)]);
}
export function nextReviewDate(store: LearnStore, expressions: readonly Expression[]): Date | null {
  const dates = learnedExpressions(store, expressions).map(entry => Date.parse(store.expressions[progressKey(entry)].due));
  return dates.length ? new Date(Math.min(...dates)) : null;
}
/** "내일", "3일 뒤" style wording for the next review date. */
export function relativeDay(target: Date, now: Date): string {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(target) - start(now)) / DAY);
  if (days <= 0) return '오늘';
  if (days === 1) return '내일';
  return `${days}일 뒤`;
}
