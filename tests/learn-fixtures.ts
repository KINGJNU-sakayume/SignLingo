/** In-memory catalogs for pure learning-path tests. Never published; no assets exist for them. */
import catalog from '../src/content/catalog.json' with { type: 'json' };
import { expressionSchema, type Catalog, type Expression } from '../src/content/schema';

export function learnEntry(id: string, overrides: Partial<Expression> = {}, index = 0): Expression {
  const source = catalog.expressions.find(e => e.id === id) ?? catalog.expressions[0];
  const entry = expressionSchema.parse(structuredClone(source));
  entry.id = id; entry.status = 'published'; entry.difficulty.cameraSuitability = 'suitable';
  entry.assets.motion = { uri: `content/assets/${id}/v1/reference.motion.json`, sha256: index.toString(16).padStart(64, '0'), bytes: 100, mediaType: 'application/json', version: 1 };
  return { ...entry, ...overrides };
}
export function learnCatalog(ids: string[], extra: Expression[] = []): Catalog {
  return { schema: 'signlingo.content', version: 1, updatedAt: '2026-10-13', lessons: catalog.lessons,
    expressions: [...ids.map((id, i) => learnEntry(id, {}, i + 1)), ...extra] };
}
