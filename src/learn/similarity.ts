import type { Expression } from '../content/schema';

/**
 * Korean equivalents such as "아니다, 아니, 부인(하다)" or "(물건이나 돈이) 없다" are split into
 * comparable stems. Two expressions whose equivalents share a stem must never appear as options
 * of the same question: a learner could not tell which answer is meant.
 */
export function koreanStems(label: string): string[] {
  const stems = new Set<string>();
  for (const part of label.split(/[,，、/;·]/)) {
    const variants = [part.replace(/\([^)]*\)/g, ''), part.replace(/[()]/g, '')];
    for (const variant of variants) {
      const text = variant.replace(/\s+/g, '').trim();
      if (!text) continue;
      stems.add(text);
      const stem = text.replace(/(하다|되다|다)$/, '');
      if (stem) stems.add(stem);
    }
  }
  return [...stems];
}
export function similarExpressions(a: Expression, b: Expression): boolean {
  if (a.id === b.id) return true;
  if (a.gloss && b.gloss && a.gloss === b.gloss) return true;
  if (a.source.entryId && a.source.entryId === b.source.entryId) return true;
  const left = koreanStems(a.displayName), right = koreanStems(b.displayName);
  return left.some(x => right.some(y => x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)))));
}
