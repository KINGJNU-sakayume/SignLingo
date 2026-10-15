import type { Landmark } from './types';
// Landmark predicates without three.js, shared by the inference worker and the solver (re-exported by math.ts).
export const valid = (p: Landmark | undefined): p is Landmark => !!p && [p.x, p.y, p.z].every(Number.isFinite);
export const confidence = (p: Landmark | undefined) => valid(p) ? Math.min(p.visibility ?? 1, p.presence ?? 1) : 0;
