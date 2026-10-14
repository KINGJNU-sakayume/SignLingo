import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importMotion } from '../motion/serialization';
import { PIPELINE_VERSIONS, type PipelineVersion } from '../motion/pipeline';
import { collectInputs, MOTION, motionName, parseArgs, VIDEO, type BatchArgs } from './args';
import { ensureModels, sha256File, wasmHashes } from './models';
import { batchMarkdown, clipMetrics, compareMarkdown, NOTICE, type BatchReport, type ClipEntry, type CompareReport, type Environment } from './report';
import { openSession, type Session } from './runner';

const MAX_BYTES = 250 * 1024 * 1024; // Motion Lab's upload limit
const WASM_DIR = path.join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const log = (message: string) => console.log(message);

async function writeReport(file: string, data: unknown, markdown: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  const md = file.replace(/\.json$/i, '.md');
  await writeFile(md, markdown);
  log(`보고서: ${file}\n요약: ${md}`);
}

async function start(args: BatchArgs): Promise<{ session: Session; environment: Environment }> {
  const { files, lock } = await ensureModels(path.join('work', 'models'), { log });
  const version = JSON.parse(await readFile(path.join('node_modules', '@mediapipe', 'tasks-vision', 'package.json'), 'utf8')).version as string;
  const session = await openSession({ models: files, wasmDir: WASM_DIR, ...(args.channel ? { channel: args.channel } : {}), log });
  return { session, environment: {
    generatedAt: new Date().toISOString(), browser: session.browser,
    models: Object.fromEntries(Object.entries(lock.models).map(([name, m]) => [name, { url: m.url, sha256: m.sha256 }])),
    wasm: { package: `@mediapipe/tasks-vision@${version}`, sha256: await wasmHashes(WASM_DIR) },
  } };
}

async function processVideoFile(session: Session, video: string, pipeline: PipelineVersion, args: BatchArgs, outDir: string): Promise<ClipEntry> {
  const info = await stat(video), file = path.basename(video);
  const entry: ClipEntry = { file, bytes: info.size, sha256: await sha256File(video), pipeline, sampleHz: args.hz, mirrored: args.mirrored };
  if (info.size > MAX_BYTES) return { ...entry, error: '250MB를 넘습니다(Motion Lab과 같은 한도).' };
  log(`${file} · ${pipeline} · ${args.hz} Hz`);
  try {
    const result = await session.process(video, { pipeline, sampleHz: args.hz, mirrored: args.mirrored });
    const clip = importMotion(result.json);
    // The same check as `content prepare`: the export must name the original file and its exact size.
    if (clip.source.name !== file || clip.source.size !== info.size) throw new Error('내보낸 source.name/size가 원본 영상과 다릅니다.');
    if (clip.pipeline.version !== pipeline) throw new Error(`요청한 ${pipeline} 대신 ${clip.pipeline.version}이 기록되었습니다.`);
    await mkdir(outDir, { recursive: true });
    const output = path.join(outDir, motionName(video));
    await writeFile(output, result.json);
    const m = result.measurements;
    return { ...entry, output, metrics: clipMetrics(clip),
      ...(m ? { measurements: { requests: m.requests, observations: m.observations, inferenceFps: m.inferenceFps, analysisFps: m.analysisFps, elapsedMs: m.elapsedMs, backend: m.backend } } : {}) };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (/decode|codec/i.test(message)) message += ' H.264 MP4라면 --channel chrome(또는 msedge)으로 다시 실행하세요.';
    log(`  실패: ${message}`);
    return { ...entry, error: message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'report') {
    const files = await collectInputs(args.inputs, MOTION, false);
    const clips: ClipEntry[] = [];
    for (const file of files) {
      const bytes = await readFile(file), clip = importMotion(bytes.toString());
      clips.push({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), bytes: bytes.length, sha256: await sha256File(file), pipeline: clip.pipeline.version, sampleHz: clip.source.sampleHz, mirrored: clip.source.mirrored, metrics: clipMetrics(clip) });
    }
    const report: BatchReport = { format: 'signlingo.motion-batch', version: 1, environment: { generatedAt: new Date().toISOString() }, clips, notice: NOTICE };
    await writeReport(args.report, report, batchMarkdown(report));
    return;
  }
  const videos = await collectInputs(args.inputs, VIDEO);
  const { session, environment } = await start(args);
  try {
    if (args.command === 'batch') {
      const clips: ClipEntry[] = [];
      for (const video of videos) clips.push(await processVideoFile(session, video, args.pipeline, args, args.out!));
      const report: BatchReport = { format: 'signlingo.motion-batch', version: 1, environment, clips, notice: NOTICE };
      await writeReport(args.report, report, batchMarkdown(report));
      if (clips.some(c => c.error)) process.exitCode = 1;
    } else {
      // Same video, same browser session and settings for both versions; only the pipeline differs.
      const clips: CompareReport['clips'] = [];
      for (const video of videos) {
        const runs: Record<string, ClipEntry> = {};
        for (const version of PIPELINE_VERSIONS) runs[version] = await processVideoFile(session, video, version, args, path.join(args.out!, version));
        const first = runs[PIPELINE_VERSIONS[0]];
        clips.push({ file: first.file, bytes: first.bytes, sha256: first.sha256, runs });
      }
      const report: CompareReport = { format: 'signlingo.motion-compare', version: 1, environment, sampleHz: args.hz, mirrored: args.mirrored, versions: [...PIPELINE_VERSIONS], clips, notice: NOTICE };
      await writeReport(args.report, report, compareMarkdown(report));
      if (clips.some(c => Object.values(c.runs).some(r => r.error))) process.exitCode = 1;
    }
    if (session.blocked.length) log(`차단한 외부 요청 ${session.blocked.length}건: ${[...new Set(session.blocked)].slice(0, 5).join(', ')}`);
  } finally { await session.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
