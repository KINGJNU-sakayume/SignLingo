/** A–B section repeat. Points are seconds on the demonstration timeline; either may be unset. */
export type LoopRange = { a: number | null; b: number | null };
export const NO_LOOP: LoopRange = { a: null, b: null };
const MIN_SPAN = .1;

/** The ordered section once both points are set and at least 0.1 s apart. */
export function activeRange(range: LoopRange): { start: number; end: number } | null {
  if (range.a === null || range.b === null) return null;
  const start = Math.min(range.a, range.b), end = Math.max(range.a, range.b);
  return end - start >= MIN_SPAN ? { start, end } : null;
}
/** Playback inside an active section: reaching B, or running outside it, continues at A. */
export function loopTime(next: number, range: LoopRange): { time: number; wrapped: boolean } {
  const section = activeRange(range);
  if (!section || (next >= section.start && next < section.end)) return { time: next, wrapped: false };
  return { time: section.start, wrapped: true };
}
export const formatSeconds = (value: number) => `${value.toFixed(1)}초`;
