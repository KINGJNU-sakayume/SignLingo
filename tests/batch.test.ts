// Batch/compare tooling: argument handling, model hash lock and per-clip metrics. Synthetic data only.
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { articulatedDetection } from './articulation';
import { fixtureClip } from './fixtures';
import { collectInputs, motionName, parseArgs, VIDEO } from '../src/batch/args';
import { ensureModels } from '../src/batch/models';
import { batchMarkdown, clipMetrics, compareMarkdown, NOTICE, warningKind, type ClipEntry } from '../src/batch/report';
import { HAND_REGION_DEFAULTS } from '../src/motion/handRegions';
import { pipelineInfo } from '../src/motion/pipeline';
import { Reconstructor } from '../src/motion/reconstruct';
import { MODELS, SIDES, type MotionClip } from '../src/motion/types';

describe('arguments', () => {
  it('defaults to 0.2.0 at 30 Hz and the documented report path; 0.3.1 only when asked', () => {
    expect(parseArgs(['batch', 'a.webm', 'videos', '--out', 'private-data/exports'])).toEqual({ command: 'batch', inputs: ['a.webm', 'videos'], out: 'private-data/exports', report: 'work/batch-report.json', hz: 30, pipeline: '0.2.0', mirrored: false, trace: [] });
    expect(parseArgs(['batch', 'a.mp4', '--out', 'o', '--hz', '15', '--pipeline', '0.3.1', '--mirrored', '--channel', 'chrome'])).toMatchObject({ hz: 15, pipeline: '0.3.1', mirrored: true, channel: 'chrome' });
    expect(parseArgs(['compare', 'private-data/videos'])).toMatchObject({ out: 'work/compare', report: 'work/compare-report.json', trace: [] });
    expect(parseArgs(['compare', 'private-data/videos', '--trace', 'ksl-no.webm', '--trace', 'ksl-ask.mp4']).trace).toEqual(['ksl-no.webm', 'ksl-ask.mp4']);
  });
  it.each([
    [['batch', 'a.webm'], '--out'],
    [['batch', 'a.webm', '--out', 'o', '--hz', '25'], '15 또는 30'],
    [['batch', 'a.webm', '--out', 'o', '--pipeline', '0.1.0'], '--pipeline'],
    [['compare', 'videos', '--pipeline', '0.3.1'], '모두 실행'],
    [['batch', 'a.webm', '--out', 'o', '--report', 'report.md'], '.json'],
    [['batch', 'a.webm', '--out'], '값이 필요'],
    [['batch', 'a.webm', '--fast'], '알 수 없는 옵션'],
    [['batch', '--out', 'o'], '입력이 없습니다'],
    [['publish', 'x'], '사용법'],
    [['batch', 'a.webm', '--out', 'o', '--trace', 'a.webm'], 'motion:compare에서만'],
    [['compare', 'videos', '--trace'], '값이 필요'],
  ])('rejects %j', (argv, message) => expect(() => parseArgs(argv)).toThrow(message));
  it('expands folders itself (Windows shells do not glob) and refuses duplicate output names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'batch-args-'));
    await mkdir(path.join(root, 'videos')); await mkdir(path.join(root, 'other'));
    for (const name of ['b.webm', 'a.MP4', 'notes.txt']) await writeFile(path.join(root, 'videos', name), '');
    await writeFile(path.join(root, 'other', 'a.MP4'), '');
    expect(await collectInputs([path.join(root, 'videos')], VIDEO)).toEqual([path.join(root, 'videos', 'a.MP4'), path.join(root, 'videos', 'b.webm')]);
    await expect(collectInputs([path.join(root, 'videos'), path.join(root, 'other', 'a.MP4')], VIDEO)).rejects.toThrow('같은 파일 이름');
    await expect(collectInputs([path.join(root, 'videos', 'notes.txt')], VIDEO)).rejects.toThrow('지원하지 않는');
    await expect(collectInputs([path.join(root, 'missing')], VIDEO)).rejects.toThrow('찾을 수 없습니다');
    expect(motionName(path.join('private-data', 'videos', 'ksl-thanks.webm'))).toBe('ksl-thanks.motion.json');
  });
});

describe('model cache', () => {
  const bytes = { [MODELS.pose]: Buffer.from('pose model bytes'), [MODELS.hand]: Buffer.from('hand model bytes') };
  const fetcher = () => vi.fn(async (url: string | URL | Request) => new Response(bytes[String(url)]));
  it('records SHA-256 on first download, then verifies the cached files without downloading', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'models-')), first = fetcher();
    const { files, lock } = await ensureModels(dir, { fetch: first as unknown as typeof fetch, now: () => new Date('2026-10-14T00:00:00Z') });
    expect(first).toHaveBeenCalledTimes(2);
    expect(await readFile(files.pose, 'utf8')).toBe('pose model bytes');
    expect(lock.models.hand).toMatchObject({ url: MODELS.hand, file: 'hand_landmarker.task', bytes: 16, recordedAt: '2026-10-14T00:00:00.000Z' });
    expect(lock.models.hand.sha256).toMatch(/^[0-9a-f]{64}$/);
    const second = fetcher();
    await ensureModels(dir, { fetch: second as unknown as typeof fetch });
    expect(second).not.toHaveBeenCalled();
  });
  it('stops on a changed cached file, a changed download or a lock recorded for another URL', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'models-'));
    const { files } = await ensureModels(dir, { fetch: fetcher() as unknown as typeof fetch });
    await writeFile(files.hand, 'tampered');
    await expect(ensureModels(dir, { fetch: fetcher() as unknown as typeof fetch })).rejects.toThrow('SHA-256');
    await writeFile(files.hand, 'hand model bytes');
    const { rm } = await import('node:fs/promises'); await rm(files.pose);
    const other = vi.fn(async () => new Response('different pose bytes'));
    await expect(ensureModels(dir, { fetch: other as unknown as typeof fetch })).rejects.toThrow('해시가 기록과 다릅니다');
    await expect(readFile(files.pose)).rejects.toThrow();
    const lockPath = path.join(dir, 'models.lock.json'), lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.models.pose.url = 'https://example.invalid/pose.task'; await writeFile(lockPath, JSON.stringify(lock));
    await expect(ensureModels(dir, { fetch: fetcher() as unknown as typeof fetch })).rejects.toThrow('다른 URL');
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    await expect(ensureModels(await mkdtemp(path.join(tmpdir(), 'models-')), { fetch: failing as unknown as typeof fetch })).rejects.toThrow('503');
  });
});

/** 30 frames at 30 Hz; both hands hidden at `hidden`, left hand from a region crop at `region`. */
function clip(version: '0.2.0' | '0.3.1', hidden: number[], region: number[] = []): MotionClip {
  const result = fixtureClip(), solver = new Reconstructor();
  result.pipeline = version === '0.3.1' ? pipelineInfo('synthetic-test-fixture-not-sign-language', HAND_REGION_DEFAULTS) : pipelineInfo('synthetic-test-fixture-not-sign-language');
  result.source = { ...result.source, sampleHz: 30, duration: 1 };
  result.frames = Array.from({ length: 30 }, (_, i) => {
    const d = articulatedDetection({ timestamp: i * 1000 / 30, flex: [.2 + i / 100, .3, .2], spread: .1, palm: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI) });
    for (const [wrist, index] of [[15, 0], [16, 1]]) d.hands[index].image[0] = { ...d.body[wrist] };
    if (version === '0.3.1') d.hands = d.hands.map((h, k) => ({ ...h, origin: k === 0 && region.includes(i) ? 'region' : 'frame' }));
    if (hidden.includes(i)) d.hands = [];
    return solver.reconstruct(d);
  });
  return result;
}

describe('clip metrics', () => {
  it('counts missing rate, held frames, reasons, region hands, warnings and corrections from the stored clip', () => {
    const metrics = clipMetrics(clip('0.3.1', [10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29], [3, 4, 5]));
    for (const side of SIDES) {
      const m = metrics.hands[side];
      expect(m.tracked + m.held + m.missing).toBe(30);
      expect(m.missingRate).toBeCloseTo((30 - m.tracked) / 30, 12);
      expect(m.held).toBeGreaterThan(0); // ≤200 ms reconstruction hold after each loss
      expect(m.reasons['no-detection']).toBe(13);
    }
    expect(metrics.hands.left.regionTracked).toBe(3);
    expect(metrics.hands.right.regionTracked).toBe(0);
    expect(metrics.warnings['no-associated-hand']).toBe(26);
    expect(metrics.warnings['hand-held']).toBe(metrics.hands.left.held + metrics.hands.right.held);
    expect(metrics.corrections.total).toBe(Object.values(metrics.corrections.byKind).reduce((a, b) => a + b, 0));
    expect(metrics.pipeline).toEqual({ version: '0.3.1', detector: 'synthetic-test-fixture-not-sign-language', handRegions: true });
  });
  it('separates learner frames bridged by temporal reconstruction from frames filled by estimate', () => {
    const hidden = [10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
    const current = clipMetrics(clip('0.3.1', hidden)), previous = clipMetrics(clip('0.2.0', hidden));
    expect(current.learner.temporal).toEqual({ applied: true });
    expect(previous.learner.temporal).toEqual({ applied: false, reason: 'not-recorded' });
    for (const side of SIDES) {
      const now = current.learner.hands[side], before = previous.learner.hands[side];
      expect(now.observed + now.interpolated + now.held + now.filled + now.missing).toBe(30);
      expect(now.fill.lead + now.fill.gap + now.fill.trail).toBe(now.filled);
      expect(now.interpolated).toBe(3); // the 100 ms gap
      expect(now.fill).toEqual({ lead: 0, gap: 0, trail: 10 }); // after the last observation: still estimated
      expect(before.interpolated).toBe(0);
      expect(before.fill).toEqual({ lead: 0, gap: 3, trail: 10 });
    }
  });
  it('maps every reconstruction warning template to a stable kind', () => {
    expect(['left: arm landmarks unreliable.', 'right: no reliable wrist-associated hand.', 'left.index.1: unusual estimated articulation; preserved for inspection.',
      '2 fixed-rig reach correction(s); inspect position distortion.', 'right.wrist: sudden rotation 48.2° (1446°/s).', 'Ambiguous hand identity near crossing wrists; uncertain hands withheld.',
      'left: elbow plane changed >60°', 'something new'].map(warningKind))
      .toEqual(['arm-unreliable', 'no-associated-hand', 'unusual-articulation', 'reach-correction', 'sudden-rotation', 'ambiguous-identity', 'elbow-plane-change', 'other']);
  });
  it('writes the requested comparison columns and lists failures outside the totals', () => {
    const entry = (pipeline: string, c?: MotionClip, error?: string): ClipEntry => ({ file: 'clip-01.webm', bytes: 1, sha256: 'a'.repeat(64), pipeline, sampleHz: 30, mirrored: false, ...(c ? { metrics: clipMetrics(c) } : {}), ...(error ? { error } : {}) });
    const hidden = [10, 11, 12];
    const markdown = compareMarkdown({ format: 'signlingo.motion-compare', version: 1, environment: { generatedAt: '2026-10-14T00:00:00Z' }, sampleHz: 30, mirrored: false, versions: ['0.2.0', '0.3.1'], notice: NOTICE,
      clips: [{ file: 'clip-01.webm', bytes: 1, sha256: 'a'.repeat(64), runs: { '0.2.0': entry('0.2.0', clip('0.2.0', hidden)), '0.3.1': entry('0.3.1', clip('0.3.1', hidden)) } },
        { file: 'clip-02.mp4', bytes: 1, sha256: 'b'.repeat(64), runs: { '0.2.0': entry('0.2.0', undefined, 'Video decode failure'), '0.3.1': entry('0.3.1', undefined, 'Video decode failure') } }] });
    expect(markdown).toContain('| 클립 | 버전 | 프레임 | 왼손 누락률 | 오른손 누락률 | held 왼/오 | 보간 왼/오 | 채움 왼손 앞·중간·뒤 | 채움 오른손 앞·중간·뒤 | 채움 대신 숨김 왼/오 |');
    expect(markdown).toMatch(/\| clip-01\.webm \| 0\.2\.0 \| 30 \| [\d.]+% \| [\d.]+% \| \d+ \/ \d+ \| 0 \/ 0 \| 0·3·0 \| 0·3·0 \| 0 \/ 0 \|/);
    expect(markdown).toMatch(/\| clip-01\.webm \| 0\.3\.1 \| 30 \| [\d.]+% \| [\d.]+% \| \d+ \/ \d+ \| 3 \/ 3 \| 0·0·0 \| 0·0·0 \| 0 \/ 0 \|/);
    expect(markdown).toContain('| 클립 | 버전 | 구간 | 프레임 | 왼손 누락률 | 오른손 누락률 | 화면 밖 왼/오 | 화면 안 실패 왼/오 |');
    expect(markdown).toContain('| 클립 | 버전 | 저장 frame/region | 배정 frame/region | 버림 (frame/region) | 주요 버림 사유 | 중복 쌍 |');
    expect(markdown).toMatch(/\| clip-01\.webm \| 0\.3\.1 \| [\d.]+–[\d.]+ s \| \d+ \| [\d.]+% \| [\d.]+% \| \d+ \/ \d+ \| \d+ \/ \d+ \|/);
    expect(markdown).toContain('## 실패 (합계에서 제외)\n- clip-02.mp4 (0.2.0): Video decode failure');
    expect(markdown).toContain('| 0.3.1 | 30 |');
    const batch = batchMarkdown({ format: 'signlingo.motion-batch', version: 1, environment: { generatedAt: 'now' }, notice: NOTICE, clips: [entry('0.3.1', clip('0.3.1', hidden))] });
    expect(batch).toContain('### clip-01.webm');
    expect(batch).toContain('경고 종류별 개수');
  });
});
