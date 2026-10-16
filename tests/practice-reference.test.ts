import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importMotion } from '../src/motion/serialization';
import { compareMotion } from '../src/practice/compare';
import { practiceReadiness } from '../src/practice/gate';
import { mirrorClip } from '../src/practice/mirror';
import { sourceClip } from '../src/motion/constraints/bake';
import type { Expression } from '../src/content/schema';

const manifest = JSON.parse(readFileSync('public/content/manifest.json', 'utf8')) as { expressions: Expression[] };
const published = manifest.expressions.map(entry => [entry.id, importMotion(readFileSync(`public/${entry.assets.motion!.uri}`, 'utf8'))] as const);
const clip = (id: string) => published.find(([key]) => key === id)![1];

describe('published practice references', () => {
  it.each(published)('%s compares with itself without missing metrics or feedback', (_, reference) => {
    expect(practiceReadiness(reference)).toEqual([]);
  });

  it('compares only the hands each sign uses', () => {
    expect(compareMotion(clip('ksl-sorry'), clip('ksl-sorry')).sides).toEqual(['right']);
    expect(compareMotion(clip('ksl-meet'), clip('ksl-meet')).sides).toEqual(['left', 'right']);
  });

  it('reports a one-handed sign made with the opposite hand once, instead of scattered differences', () => {
    for (const id of ['ksl-thanks', 'ksl-sorry']) {
      const result = compareMotion(clip(id), mirrorClip(clip(id)));
      expect(result.mirror?.detected, id).toBe(true);
      expect(result.feedback.filter(f => f.kind === 'observed').map(f => f.key), id).toEqual(['mirror']);
    }
  });

  it('does not call a mirror-symmetric two-handed sign an opposite-hand attempt', () => {
    expect(compareMotion(clip('ksl-meet'), mirrorClip(clip('ksl-meet'))).mirror?.detected).toBe(false);
  });

  it('notices a raised hand the reference does not use', () => {
    const sorry = clip('ksl-sorry'), meet = clip('ksl-meet');
    const result = compareMotion(sorry, meet, undefined, undefined, { mirror: false });
    expect(result.feedback.some(f => f.key === 'unused' && f.side === 'left')).toBe(true);
  });

  it('grades the reviewed handshape and palm constraints relative to the reference signer', () => {
    for (const [id, reference] of published) {
      for (const learner of [reference, sourceClip(reference)]) {
        const rubric = compareMotion(reference, learner).rubric;
        expect(rubric.length, id).toBeGreaterThan(0);
        expect(rubric.every(item => item.passes === true), id).toBe(true);
      }
    }
    // A different sign (index hands for 'thanks', flat hands for 'meet') misses every reviewed form.
    for (const [ref, other] of [['ksl-thanks', 'ksl-meet'], ['ksl-meet', 'ksl-thanks']]) {
      const result = compareMotion(clip(ref), clip(other));
      expect(result.rubric.every(item => item.passes === false), ref).toBe(true);
      expect(result.feedback.filter(f => f.key === 'shape').length, ref).toBe(2);
    }
  });
});

describe('hand size guidance', () => {
  it('measures course references as large enough and flags a distant learner', async () => {
    const { handSize, MIN_HAND_SIZE } = await import('../src/practice/diagnostics');
    for (const [id, reference] of published) expect(handSize(reference)!, id).toBeGreaterThan(MIN_HAND_SIZE);
    // The same attempt filmed from twice the distance: hand landmarks shrink toward the frame center.
    const far = structuredClone(clip('ksl-thanks'));
    for (const frame of far.frames) for (const hand of frame.hands) for (const p of hand.image) { p.x = .5 + (p.x - .5) / 2.5; p.y = .5 + (p.y - .5) / 2.5; }
    expect(handSize(far)!).toBeLessThan(MIN_HAND_SIZE);
  });
});
