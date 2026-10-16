// Constraint documents, reports and command-line arguments. The published clip is read, never written.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import catalog from '../src/content/catalog.json';
import releases from '../public/content/releases.json';
import { constraintsName, parseArgs } from '../src/batch/args';
import { batchMarkdown, type BatchReport } from '../src/batch/report';
import { batchConstraintEntry, constraintMarkdown, constraintReport } from '../src/batch/constraintReport';
import { importMotion } from '../src/motion/serialization';
import { applyConstraints, constraintHash, HANDSHAPES, parseConstraints, PRESET_IDS, sourceClip } from '../src/motion/constraints';
import { FINGERS, SIDES } from '../src/motion/types';
import { deepestPenetration, handsOf, leftward } from '../src/motion/handContact';

const doc = readFileSync('docs/CONSTRAINTS.md', 'utf8');
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('docs/CONSTRAINTS.md', () => {
  it('has at least five examples, every JSON block is a valid document, and course-1 examples match the shipped files', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const parsed = blocks.map(block => parseConstraints(block));
    for (const id of ['ksl-thanks', 'ksl-sorry', 'ksl-meet']) {
      const file = readFileSync(`docs/constraints/${id}.constraints.json`, 'utf8');
      expect(blocks.map(b => b.trim())).toContain(file.trim());
      const expression = catalog.expressions.find(e => e.id === id)!;
      // A post-review correction (ksl-sorry, revision 3) keeps the description first and appends the review finding.
      expect(parseConstraints(file).request!.startsWith(expression.description)).toBe(true);
    }
    expect(parsed.filter(set => set.request && !set.expression).length).toBeGreaterThan(0);
  });
  it('lists every point kind, preset and its rotation table exactly as the code defines them', () => {
    for (const id of PRESET_IDS) expect(doc).toContain(`| \`${id}\` | ${HANDSHAPES[id].label} |`);
    const cell = (joints: readonly (readonly [number, number])[]) => joints.map(([f, s]) => s ? `${f}(${s > 0 ? '+' : ''}${s})` : `${f}`).join(' · ');
    for (const id of PRESET_IDS) expect(doc).toContain(`| \`${id}\` | ${FINGERS.map(f => cell(HANDSHAPES[id].fingers[f])).join(' | ')} |`);
    for (const kind of ['sameHeight', 'contact', 'symmetry', 'handshape', 'palmFacing', 'hold', 'wristOffset']) expect(doc).toContain(`### \`${kind}\``);
  });
  it('keeps the numbered-finger notation out of code and preset names (the docs table is the only translation)', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    for (const file of [...files('src/motion/constraints'), 'src/components/ConstraintPanel.tsx']) expect(readFileSync(file, 'utf8'), file).not.toMatch(/[0-9]지/);
  });
});

describe('published course 1: the documented meet example (read only)', () => {
  it('brings the hands together until they touch, centered, without touching the asset', async () => {
    const file = `public/${catalog.expressions.find(e => e.id === 'ksl-meet')!.assets.motion!.uri}`;
    // The published revision is this example applied to its own source (the stored observation inside the corrected clip).
    const asset = catalog.expressions.find(e => e.id === 'ksl-meet')!.assets.motion!;
    expect(sha(file)).toBe(asset.sha256);
    const clip = sourceClip(importMotion(readFileSync(file, 'utf8'))), set = parseConstraints(readFileSync('docs/constraints/ksl-meet.constraints.json', 'utf8'));
    const { clip: corrected, source, solution } = await applyConstraints(clip, set);
    const report = constraintReport({ set, source, corrected, solution, constraintFile: 'docs/constraints/ksl-meet.constraints.json', constraintSha256: await constraintHash(set),
      motion: { file, bytes: 1, sha256: asset.sha256, version: 1, pipeline: '0.2.0', frames: clip.frames.length, sampleHz: 30, duration: clip.source.duration }, generatedAt: 'test' });
    const result = (id: string) => report.results.find(r => r.id === id)!;
    expect(result('meet-touch').before.max!).toBeGreaterThan(.15);
    // The curled fingers of the two fists touch before the index fingers can (avatar fist geometry): the solver stops
    // there instead of pushing the hands into each other, and reports those frames as blocked.
    expect(result('meet-touch').after.max!).toBeLessThan(result('meet-touch').before.max! / 1.5);
    expect(result('meet-touch').blockedFrames).toBeGreaterThan(0);
    expect(result('meet-center').after.max!).toBeLessThanOrEqual(.02 + 1e-9);
    for (const frame of corrected.frames) {
      const hands = handsOf(frame.pose);
      if (frame.constraint && SIDES.every(side => frame.pose.quality[`${side}Arm`] > 0)) expect(deepestPenetration(hands.left, hands.right, leftward(frame.pose))?.depth ?? 0).toBeLessThanOrEqual(.001);
    }
    expect(result('meet-index-shape').after.max).toBe(0);
    expect(report.changes.outsideSpans).toBe(0);
    // The re-recording tracks both hands throughout the spans: every change adjusts an observed hand.
    expect(report.changes.hands.left.observed + report.changes.hands.right.observed).toBeGreaterThan(0);
    expect(report.integrity).toMatchObject({ landmarksUnchanged: true, qualityUnchanged: true, roundTrip: true });
    expect(report.integrity.maxArmLengthErrorMeters).toBeLessThan(1e-9);
    const markdown = constraintMarkdown(report);
    expect(markdown).toContain('# 제약 조건 보정 보고서'); expect(markdown).toContain('meet-touch'); expect(markdown).toContain('표정·비수지 신호');
    expect(sha(file)).toBe(asset.sha256);
    expect(catalog.expressions.find(e => e.id === 'ksl-meet')!.constraints).toEqual({ sha256: await constraintHash(set), count: set.constraints.length });
    // The other two description examples apply cleanly too.
    for (const id of ['ksl-thanks', 'ksl-sorry']) {
      const other = importMotion(readFileSync(`public/content/assets/${id}/v1/reference.motion.json`, 'utf8'));
      const applied = await applyConstraints(other, parseConstraints(readFileSync(`docs/constraints/${id}.constraints.json`, 'utf8')));
      expect(applied.clip.version).toBe(2);
      expect(applied.solution.constraints.every(c => c.summary.activeFrames > 0)).toBe(true);
    }
  });
});

describe('command-line arguments and batch report', () => {
  it('accepts --constraints only for motion:batch and needs two JSON files for constrain-report', () => {
    expect(parseArgs(['batch', 'v', '--out', 'o', '--constraints', 'docs/constraints'])).toMatchObject({ constraints: 'docs/constraints', pipeline: '0.2.0' });
    expect(parseArgs(['batch', 'v', '--out', 'o']).constraints).toBeUndefined();
    expect(() => parseArgs(['compare', 'v', '--constraints', 'c'])).toThrow('motion:batch');
    expect(parseArgs(['constrain-report', 'a.motion.json', 'b.constraints.json'])).toMatchObject({ command: 'constrain-report', report: 'work/constraint-report.json', inputs: ['a.motion.json', 'b.constraints.json'] });
    expect(() => parseArgs(['constrain-report', 'a.motion.json'])).toThrow('두 파일');
    expect(constraintsName('docs/constraints', 'private-data/videos/ksl-meet.webm')).toBe(path.join('docs/constraints', 'ksl-meet.constraints.json'));
    expect(constraintsName('c', 'clips/ksl-thanks.MP4')).toBe(path.join('c', 'ksl-thanks.constraints.json'));
  });
  it('lists the constraints applied right after recognition', async () => {
    // Revision 1 with the document of revision 3 (recorded inside that published motion).
    const clip = importMotion(readFileSync('public/content/assets/ksl-meet/v1/reference.motion.json', 'utf8'));
    const set = importMotion(readFileSync('public/content/assets/ksl-meet/v3/reference.motion.json', 'utf8')).constraints!.document;
    const applied = await applyConstraints(clip, set);
    const entry = batchConstraintEntry('docs/constraints/ksl-meet.constraints.json', await constraintHash(set), applied.clip, applied.solution);
    expect(entry).toMatchObject({ count: 4, changedFrames: 60 });
    const report: BatchReport = { format: 'signlingo.motion-batch', version: 1, environment: { generatedAt: 'test' }, notice: 'test',
      clips: [{ file: 'ksl-meet.webm', bytes: 1, sha256: 'a'.repeat(64), pipeline: '0.2.0', sampleHz: 30, mirrored: false, constraints: entry }] };
    expect(batchMarkdown(report)).toContain('## 인식 직후 적용한 제약 조건');
    expect(batchMarkdown(report)).toContain('meet-touch 20.6 cm → 11.0 cm');
  });
});
