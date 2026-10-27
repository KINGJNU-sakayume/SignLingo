import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { PIPELINE_VERSIONS, type PipelineVersion } from '../motion/pipeline';

export type Command = 'batch' | 'compare' | 'report' | 'constrain-report' | 'import';
export type BatchArgs = {
  command: Command; inputs: string[]; out?: string; report: string;
  hz: 15 | 30; pipeline: PipelineVersion; mirrored: boolean; channel?: string;
  /** compare only: video file names to write frame-by-frame work/trace-<name>.json/.md for. */
  trace: string[];
  /** batch and import: folder of `<video name>.constraints.json` applied right after recognition. */
  constraints?: string;
  /** import only: folder holding the source videos; each is checked against the detections' name, size and SHA-256. */
  videos?: string;
};
export const USAGE = `사용법
  npm run motion:batch -- <영상 또는 폴더...> --out <출력 폴더> [--hz 30|15] [--pipeline 0.2.0|0.3.1] [--mirrored] [--report work/batch-report.json]
  npm run motion:compare -- <영상 폴더 또는 영상...> [--hz 30|15] [--mirrored] [--out work/compare] [--report work/compare-report.json] [--trace <영상 파일 이름>]...
    --trace는 여러 번 쓸 수 있고, 클립마다 work/trace-<이름>.json/.md(프레임별 진단, 픽셀 없음)를 만듭니다.
  npm run motion:report -- <motion.json 또는 폴더...> [--report work/motion-report.json]
  npm run motion:constrain-report -- <motion.json> <constraints.json> [--report work/constraint-report.json]
  npm run motion:import -- <detections.json 또는 폴더...> --out <출력 폴더> [--videos <원본 영상 폴더>] [--constraints <폴더>] [--report work/import-report.json]
    로컬 추출기(tools/extract/)가 만든 signlingo.detections를 Motion Lab과 같은 복원기로 MotionClip으로 바꿉니다.
batch·import: [--constraints <폴더>] 영상 이름과 같은 <이름>.constraints.json이 있으면 인식 직후 적용합니다(docs/CONSTRAINTS.md).
공통: [--channel chrome|msedge] (H.264 MP4는 설치된 Chrome/Edge로 디코딩), CHROMIUM_PATH=<실행 파일>`;

// The private evaluation workflow collects work/*report*; keep these names.
const DEFAULT_REPORT: Record<Command, string> = { batch: 'work/batch-report.json', compare: 'work/compare-report.json', report: 'work/motion-report.json', 'constrain-report': 'work/constraint-report.json', import: 'work/import-report.json' };

/** Pure argument parsing; inputs are expanded separately because shells on Windows do not glob. */
export function parseArgs(argv: readonly string[]): BatchArgs {
  const [command, ...rest] = argv;
  if (command !== 'batch' && command !== 'compare' && command !== 'report' && command !== 'constrain-report' && command !== 'import') throw new Error(USAGE);
  const inputs: string[] = [];
  const options: Record<string, string | true> = {}, trace: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { inputs.push(arg); continue; }
    const name = arg.slice(2);
    if (name === 'mirrored') { options.mirrored = true; continue; }
    if (!['out', 'hz', 'pipeline', 'report', 'channel', 'trace', 'constraints', 'videos'].includes(name)) throw new Error(`알 수 없는 옵션 --${name}\n${USAGE}`);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name}에 값이 필요합니다.\n${USAGE}`);
    if (name === 'trace') trace.push(value); else options[name] = value;
  }
  if (!inputs.length) throw new Error(`입력이 없습니다.\n${USAGE}`);
  const hz = Number(options.hz ?? 30);
  if (hz !== 15 && hz !== 30) throw new Error('--hz는 Motion Lab과 같은 15 또는 30만 허용합니다.');
  const pipeline = (options.pipeline ?? '0.2.0') as PipelineVersion; // 0.3.1 is the opt-in experiment
  if (!PIPELINE_VERSIONS.includes(pipeline)) throw new Error(`--pipeline은 ${PIPELINE_VERSIONS.join(' 또는 ')}입니다.`);
  if (command === 'compare' && options.pipeline) throw new Error(`compare는 ${PIPELINE_VERSIONS.join('과 ')}을 모두 실행합니다. --pipeline을 빼세요.`);
  if (trace.length && command !== 'compare') throw new Error('--trace는 motion:compare에서만 씁니다(두 버전을 프레임별로 비교).');
  if ((command === 'batch' || command === 'import') && typeof options.out !== 'string') throw new Error(`${command}에는 --out <출력 폴더>가 필요합니다.\n${USAGE}`);
  if (options.constraints && command !== 'batch' && command !== 'import') throw new Error('--constraints는 motion:batch·motion:import에서만 씁니다(인식 직후 적용). 이미 있는 동작은 motion:constrain-report나 content constrain을 쓰세요.');
  if (options.videos && command !== 'import') throw new Error('--videos는 motion:import에서만 씁니다.');
  if (command === 'import' && (options.hz || options.pipeline || options.mirrored || options.channel)) throw new Error('import는 추출기가 기록한 샘플링·반전을 그대로 씁니다. --hz·--pipeline·--mirrored·--channel은 추출기(tools/extract/)에 주세요.');
  if (command === 'constrain-report' && (inputs.length !== 2 || !MOTION.test(inputs[0]) || !MOTION.test(inputs[1]))) throw new Error(`constrain-report에는 <motion.json> <constraints.json> 두 파일이 필요합니다.\n${USAGE}`);
  const report = typeof options.report === 'string' ? options.report : DEFAULT_REPORT[command];
  if (!report.endsWith('.json')) throw new Error('--report는 .json 경로입니다(같은 이름의 .md도 만듭니다).');
  return { command, inputs, report, hz, pipeline, mirrored: options.mirrored === true, trace,
    ...(typeof options.out === 'string' ? { out: options.out } : command === 'compare' ? { out: 'work/compare' } : {}),
    ...(typeof options.channel === 'string' ? { channel: options.channel } : {}),
    ...(typeof options.constraints === 'string' ? { constraints: options.constraints } : {}),
    ...(typeof options.videos === 'string' ? { videos: options.videos } : {}) };
}

export const VIDEO = /\.(mp4|webm)$/i;
export const MOTION = /\.json$/i;
export const DETECTIONS = /\.detections\.json$/i;
/**
 * Files as given plus the matching files directly inside given folders (sorted, not recursive). With
 * `uniqueNames`, duplicate basenames are rejected because outputs are named after them.
 */
export async function collectInputs(inputs: readonly string[], pattern: RegExp, uniqueNames = true): Promise<string[]> {
  const files: string[] = [];
  for (const input of inputs) {
    const info = await stat(input).catch(() => { throw new Error(`찾을 수 없습니다: ${input}`); });
    if (info.isDirectory()) {
      const names = (await readdir(input)).filter(name => pattern.test(name)).sort();
      files.push(...names.map(name => path.join(input, name)));
    } else if (pattern.test(input)) files.push(input);
    else throw new Error(`지원하지 않는 파일입니다: ${input}`);
  }
  if (!files.length) throw new Error('처리할 파일이 없습니다.');
  const seen = new Map<string, string>();
  if (uniqueNames) for (const file of files) {
    const name = path.basename(file), previous = seen.get(name);
    if (previous !== undefined) throw new Error(`같은 파일 이름이 두 번 있습니다: ${previous}, ${file}`);
    seen.set(name, file);
  }
  return files;
}
/** Same naming as Motion Lab's "JSON 내보내기". */
export const motionName = (video: string) => path.basename(video).replace(/\.[^.]+$/, '') + '.motion.json';
/** `--constraints <folder>`: the prior-intent document for a video is `<folder>/<video name>.constraints.json`. */
export const constraintsName = (folder: string, video: string) => path.join(folder, path.basename(video).replace(/\.[^.]+$/, '') + '.constraints.json');
