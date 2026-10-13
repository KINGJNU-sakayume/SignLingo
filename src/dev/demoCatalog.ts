/**
 * DEVELOPMENT ONLY. Synthetic, in-memory demo content so the learning flow can be tried while no
 * expression is published. These motions are NOT Korean Sign Language and are labelled
 * "데모 동작 A…F". Nothing here is written to public/, passed through parseLessonMotion or
 * bundled into production (see scripts/check-dist.mjs).
 */
import type { Catalog, Expression } from '../content/schema';
import { sha256 } from '../content/validation';
import type { MotionClip } from '../motion/types';
import { practiceClip } from '../../tests/practice-fixtures';

export const DEMO_MARKER = 'SIGNLINGO_DEMO_CONTENT';
const REPOSITORY = 'https://github.com/KINGJNU-sakayume/SignLingo';
const MEANING = '실제 한국수어가 아닌 화면 확인용 동작';
const MOTIONS: { letter: string; unit: string; options: Parameters<typeof practiceClip>[0] }[] = [
  { letter: 'A', unit: 'demo-basics', options: {} },
  { letter: 'B', unit: 'demo-basics', options: { swap: true } },
  { letter: 'C', unit: 'demo-basics', options: { lift: -.8 } },
  { letter: 'D', unit: 'demo-basics', options: { idle: true, swap: true } },
  { letter: 'E', unit: 'demo-more', options: { endPhase: .5, duration: 1.4 } },
  { letter: 'F', unit: 'demo-more', options: { reverse: true, swap: true } },
];

async function entry(letter: string, unit: string, order: number, clip: MotionClip): Promise<Expression> {
  const id = `demo-${letter.toLowerCase()}`, bytes = new TextEncoder().encode(JSON.stringify(clip));
  return {
    id, revision: 1, displayName: `데모 동작 ${letter}`, gloss: null, category: '데모', lessonId: unit, order,
    difficulty: { level: 'beginner', rationale: '학습 화면 확인용', cameraSuitability: 'suitable' },
    description: MEANING, meaning: MEANING, movementNotes: ['합성 테스트 동작이에요. 실제 수어로 익히지 마세요.'],
    source: { title: 'SignLingo 개발용 합성 데모 (실제 수어 아님)', url: REPOSITORY, owner: 'SignLingo 개발 데모', attribution: '합성 테스트 동작 · 실제 한국수어 아님',
      locator: `${DEMO_MARKER} · tests/practice-fixtures.ts`, entryId: `demo-${letter}`, checkedAt: '2026-10-13', videoAvailability: 'unknown' },
    license: { type: '데모 전용 · 배포하지 않음', policyUrl: REPOSITORY, notes: '개발 서버의 ?demo=1 에서만 보여요.',
      permissions: { importVideo: 'denied', deriveMotion: 'denied', publishMotion: 'denied', publishVideo: 'denied', externalVideo: 'denied', publicRepository: 'denied', publicWebsite: 'denied' } },
    variant: { id: null, description: '데모 동작 (실제 수어 아님)', status: 'unresolved' },
    assets: { motion: { uri: `content/assets/${id}/v1/demo.motion.json`, sha256: await sha256(bytes), bytes: bytes.length, mediaType: 'application/json', version: 1 } },
    reconstructionVersion: clip.pipeline.version, provenance: 'synthetic-test',
    reviews: { reconstruction: { status: 'pending' }, linguistic: { status: 'pending' } }, status: 'candidate', updatedAt: '2026-10-13',
  };
}

export async function buildDemoCatalog(): Promise<{ catalog: Catalog; clips: Map<string, MotionClip> }> {
  const clips = new Map<string, MotionClip>(), expressions: Expression[] = [];
  for (const [order, motion] of MOTIONS.entries()) {
    const clip = practiceClip(motion.options);
    const value = await entry(motion.letter, motion.unit, order, clip);
    clips.set(value.id, clip); expressions.push(value);
  }
  const catalog: Catalog = { schema: 'signlingo.content', version: 1, updatedAt: '2026-10-13', expressions, lessons: [
    { id: 'demo-basics', title: '데모: 학습 흐름 둘러보기', category: '데모', description: '실제 한국수어가 아닌 합성 동작으로 화면과 흐름을 확인해요.', order: 0 },
    { id: 'demo-more', title: '데모: 단원 이어 가기', category: '데모', description: '두 번째 단원으로 넘어가는 흐름을 확인해요.', order: 1 },
    { id: 'demo-later', title: '데모: 준비 중인 단원', category: '데모', description: '공개 표현이 없는 단원이 어떻게 보이는지 확인해요.', order: 2 },
  ] };
  return { catalog, clips };
}
