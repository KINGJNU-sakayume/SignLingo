/** DEVELOPMENT ONLY: loaded through a dynamic import guarded by import.meta.env.DEV in Shell.tsx. */
import type { ContentSource } from '../learn/source';
import { buildDemoCatalog } from './demoCatalog';

let demo: ReturnType<typeof buildDemoCatalog> | null = null;
const load = () => demo ??= buildDemoCatalog();

export const demoSource: ContentSource = {
  kind: 'demo',
  banner: '데모 모드 · 실제 수어 아님',
  // Separate keys so demo progress never mixes with real learning records.
  storage: { progress: 'signlingo.demo.progress.v1', learn: 'signlingo.demo.learn.v2' },
  loadCatalog: async () => (await load()).catalog,
  async loadMotion(entry) {
    const clip = (await load()).clips.get(entry.id);
    if (!clip) throw new Error('Unknown demo motion');
    return clip;
  },
  loadVideo: async () => null,
};
