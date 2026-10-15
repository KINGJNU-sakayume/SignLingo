import type { Span } from './schema';

/** A span in clip time. `basis` says where the times came from (phase/fraction use the signing interval). */
export type ResolvedSpan = { startMs: number; endMs: number; firstFrame: number; lastFrame: number; basis: 'frames' | 'ms' | 'active-interval' };
/** Signing interval in seconds, as `activeInterval()` returns it. */
export type SigningInterval = { start: number; end: number; method: string };

const PHASES = { start: [0, 1 / 3], middle: [1 / 3, 2 / 3], end: [2 / 3, 1], whole: [0, 1] } as const;

/** Clip times of a span, or null when it selects no frame (e.g. a frame range past the end). */
export function resolveSpan(span: Span, timestamps: readonly number[], interval: SigningInterval): ResolvedSpan | null {
  if (!timestamps.length) return null;
  let startMs: number, endMs: number, basis: ResolvedSpan['basis'];
  if ('frames' in span) {
    const [a, b] = span.frames;
    if (a > timestamps.length - 1) return null;
    startMs = timestamps[a]; endMs = timestamps[Math.min(b, timestamps.length - 1)]; basis = 'frames';
  } else if ('ms' in span) {
    [startMs, endMs] = span.ms; basis = 'ms';
  } else {
    const [a, b] = 'phase' in span ? PHASES[span.phase] : span.fraction;
    const start = interval.start * 1000, length = (interval.end - interval.start) * 1000;
    startMs = start + a * length; endMs = start + b * length; basis = 'active-interval';
  }
  const inside = timestamps.flatMap((t, i) => t >= startMs - 1e-6 && t <= endMs + 1e-6 ? [i] : []);
  if (!inside.length) return null;
  return { startMs, endMs, firstFrame: inside[0], lastFrame: inside.at(-1)!, basis };
}

/**
 * Blend weight at time t: 0 outside the span, rising (smoothstep) over the first `blendMs` inside it, 1 in the
 * core, falling over the last `blendMs`. The blend lies INSIDE the span, so frames outside never change.
 */
export function blendWeight(t: number, span: ResolvedSpan, blendMs: number): number {
  if (t < span.startMs - 1e-6 || t > span.endMs + 1e-6) return 0;
  const ramp = Math.min(blendMs, (span.endMs - span.startMs) / 2);
  if (ramp <= 0) return 1;
  const x = Math.min(1, Math.max(0, Math.min(t - span.startMs, span.endMs - t) / ramp));
  return x * x * (3 - 2 * x);
}
