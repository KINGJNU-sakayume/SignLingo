import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
const id = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);
const date = z.iso.date();
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const https = z.url().refine(value => new URL(value).protocol === 'https:', 'HTTPS URL required');
const evidence = z.object({ reviewer: text, qualification: text, date, reference: text, notes: text,
  document: z.object({ path: z.string().regex(/^docs\/content-reviews\/[a-z0-9-]+\.md$/), sha256: sha256Schema }).strict(),
}).strict();
export const STATES = ['candidate', 'rights-review-required', 'source-approved', 'motion-processing-required',
  'reconstruction-review-required', 'linguistic-review-required', 'ready-to-publish', 'published'] as const;
export const STATE_LABELS: Record<typeof STATES[number], string> = {
  candidate: '후보', 'rights-review-required': '이용 허락 확인 중', 'source-approved': '원본 사용 승인',
  'motion-processing-required': '동작 추출 준비 중', 'reconstruction-review-required': '3D 동작 검수 중',
  'linguistic-review-required': '한국수어 검수 중', 'ready-to-publish': '공개 준비 완료', published: '학습 가능',
};
const decision = z.enum(['unknown', 'allowed', 'denied']);
export const assetSchema = z.object({
  uri: text.refine(value => /^content\/assets\/[a-z0-9-]+\/v[1-9][0-9]*\/[a-z0-9.-]+$/.test(value) ||
    (value.startsWith('https://') && !new URL(value).username && !new URL(value).password), 'Versioned content path or HTTPS required'),
  sha256: sha256Schema, bytes: z.number().int().positive().max(250 * 1024 * 1024),
  mediaType: z.enum(['application/json', 'video/mp4', 'video/webm']), version: z.number().int().positive(),
}).strict();
const review = z.object({
  status: z.enum(['pending', 'changes-requested', 'approved']),
  evidence: evidence.optional(), subjectSha256: sha256Schema.optional(),
}).strict();
export const expressionSchema = z.object({
  id, revision: z.number().int().positive(), displayName: text, gloss: text.nullable(),
  category: text, lessonId: id, order: z.number().int().nonnegative(),
  difficulty: z.object({ level: z.literal('beginner'), rationale: text, cameraSuitability: z.enum(['unreviewed', 'suitable', 'limited']) }).strict(),
  description: text, meaning: text, movementNotes: z.array(text),
  source: z.object({ title: text, url: https, owner: text, attribution: text, locator: text,
    entryId: text.nullable(), checkedAt: date, videoAvailability: z.enum(['listed', 'confirmed', 'unknown']),
    originalVideoUrl: https.optional(), videoSha256: sha256Schema.optional(),
  }).strict(),
  license: z.object({ type: text, policyUrl: https, notes: text,
    permissions: z.object({ importVideo: decision, deriveMotion: decision, publishMotion: decision, publishVideo: decision,
      externalVideo: decision, publicRepository: decision, publicWebsite: decision }).strict(),
    approval: evidence.extend({ sourceSha256: sha256Schema }).strict().optional(),
  }).strict(),
  variant: z.object({ id: text.nullable(), description: text, status: z.enum(['unresolved', 'identified']) }).strict(),
  assets: z.object({ motion: assetSchema.optional(), video: assetSchema.optional() }).strict(),
  reconstructionVersion: text.nullable(), provenance: z.enum(['unacquired', 'authorized-video', 'synthetic-test']),
  reviews: z.object({ reconstruction: review, linguistic: review }).strict(),
  status: z.enum(STATES), updatedAt: date,
}).strict();
export const lessonSchema = z.object({ id, title: text, category: text, description: text, order: z.number().int().nonnegative() }).strict();
export const catalogSchema = z.object({
  schema: z.literal('signlingo.content'), version: z.literal(1), updatedAt: date,
  lessons: z.array(lessonSchema), expressions: z.array(expressionSchema),
}).strict();
export type Expression = z.infer<typeof expressionSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type ContentState = Expression['status'];
