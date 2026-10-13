import type { Catalog, Expression } from '../content/schema';
import { progressKey } from '../lessons/catalog';
import type { NodeKind, NodeState } from '../design/PathNode';
import type { LearnStore } from './storage';

export type UnitTheme = 'leaf' | 'sky' | 'sun' | 'grape';
export const UNIT_THEMES: readonly UnitTheme[] = ['leaf', 'sky', 'sun', 'grape'];
/** Zigzag offsets (px) around the path's centre line, repeated for each unit. */
export const NODE_OFFSETS = [0, 44, 64, 44, 0, -44, -64, -44] as const;

export type PathNodeModel = {
  id: string; unitId: string; kind: NodeKind | 'soon'; state: NodeState; offset: number;
  /** 1-based lesson number within the unit (lessons only). */
  lessonNumber: number; lessonCount: number;
  /** Expression IDs taught by a lesson, reviewed by a unit review, or covered by the trophy. */
  expressions: string[]; completedAt?: string;
};
export type UnitModel = {
  id: string; number: number; title: string; category: string; description: string; theme: UnitTheme;
  soon: boolean; expressions: Expression[]; nodes: PathNodeModel[]; completed: boolean;
};
export type PathModel = { units: UnitModel[]; current: PathNodeModel | null; hasContent: boolean };

/** Splits n expressions into lessons of two or three (one only when n = 1). */
export function groupSizes(n: number): number[] {
  if (n <= 0) return [];
  const groups = Math.ceil(n / 3), base = Math.floor(n / groups), extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}
/** Node IDs embed content identity, so a new revision or asset hash resets completion. */
export function nodeId(kind: 'lesson' | 'review', unitId: string, entries: readonly Expression[]) {
  return `${kind}:${unitId}:${entries.map(progressKey).join('+')}`;
}
export function unitExpressions(catalog: Catalog, unitId: string) {
  return catalog.expressions.filter(entry => entry.lessonId === unitId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function buildPath(catalog: Catalog, store: LearnStore, now = new Date()): PathModel {
  const lessons = catalog.lessons.slice().sort((a, b) => a.order - b.order);
  let current: PathNodeModel | null = null;
  const due = (entry: Expression) => { const record = store.expressions[progressKey(entry)]; return !!record && Date.parse(record.due) <= now.getTime(); };
  const units = lessons.map((lesson, unitIndex): UnitModel => {
    const expressions = unitExpressions(catalog, lesson.id);
    const theme = UNIT_THEMES[unitIndex % UNIT_THEMES.length];
    if (!expressions.length) {
      const nodes = [0, 1, 2].map((i): PathNodeModel => ({ id: `soon:${lesson.id}:${i}`, unitId: lesson.id, kind: 'soon', state: 'coming-soon',
        offset: NODE_OFFSETS[i % NODE_OFFSETS.length], lessonNumber: i + 1, lessonCount: 3, expressions: [] }));
      return { id: lesson.id, number: unitIndex + 1, title: lesson.title, category: lesson.category, description: lesson.description, theme, soon: true, expressions, nodes, completed: false };
    }
    const sizes = groupSizes(expressions.length);
    const nodes: PathNodeModel[] = [];
    let start = 0;
    for (const [i, size] of sizes.entries()) {
      const group = expressions.slice(start, start + size); start += size;
      nodes.push({ id: nodeId('lesson', lesson.id, group), unitId: lesson.id, kind: 'lesson', state: 'locked', offset: 0, lessonNumber: i + 1, lessonCount: sizes.length, expressions: group.map(e => e.id) });
    }
    nodes.push({ id: nodeId('review', lesson.id, expressions), unitId: lesson.id, kind: 'review', state: 'locked', offset: 0, lessonNumber: 0, lessonCount: sizes.length, expressions: expressions.map(e => e.id) });
    nodes.push({ id: `trophy:${lesson.id}`, unitId: lesson.id, kind: 'trophy', state: 'locked', offset: 0, lessonNumber: 0, lessonCount: sizes.length, expressions: expressions.map(e => e.id) });
    const byId = new Map(expressions.map(e => [e.id, e]));
    for (const [i, node] of nodes.entries()) {
      node.offset = NODE_OFFSETS[i % NODE_OFFSETS.length];
      if (node.kind === 'trophy') continue;
      const record = store.nodes[node.id];
      if (record) {
        node.completedAt = record.completedAt;
        node.state = node.kind === 'lesson' && node.expressions.some(id => due(byId.get(id)!)) ? 'review-due' : 'completed';
      } else if (!current) { node.state = 'current'; current = node; }
    }
    const completed = nodes.every(node => node.kind === 'trophy' || node.completedAt);
    nodes[nodes.length - 1].state = completed ? 'completed' : 'locked';
    return { id: lesson.id, number: unitIndex + 1, title: lesson.title, category: lesson.category, description: lesson.description, theme, soon: false, expressions, nodes, completed };
  });
  return { units, current, hasContent: catalog.expressions.length > 0 };
}
/** Rough duration shown in the node popover. */
export function estimateMinutes(node: PathNodeModel) {
  return node.kind === 'lesson' ? node.expressions.length + 1 : 3;
}
