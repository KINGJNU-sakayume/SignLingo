import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const input = option('--motion'), output = option('--output') ?? 'work/evaluation/temporal.json';
if ((!input || !args.includes('--consent')) && !args.includes('--synthetic')) {
  console.error('Usage: npm run evaluate:temporal -- --motion PRIVATE.motion.json --consent [--output work/evaluation/temporal.json]\nOr: npm run evaluate:temporal -- --synthetic\nNo source media or landmarks are included in the aggregate report.');
  process.exit(1);
}
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { importMotion } = await server.ssrLoadModule('/src/motion/serialization.ts');
  const { Reconstructor } = await server.ssrLoadModule('/src/motion/reconstruct.ts');
  const { reconstructTemporal, reconstructTemporalAsync } = await server.ssrLoadModule('/src/motion/temporalReconstruction.ts');
  const { controlledOcclusion, temporalSummary } = await server.ssrLoadModule('/src/motion/temporalEvaluation.ts');
  let clip, bytes;
  if (args.includes('--synthetic')) {
    const { articulatedDetection } = await server.ssrLoadModule('/tests/articulation.ts');
    const { fixtureClip } = await server.ssrLoadModule('/tests/fixtures.ts');
    const { Quaternion, Vector3 } = await import('three');
    clip = fixtureClip(); clip.source.duration = 2.1; clip.source.sampleHz = 30; clip.pipeline.version = '0.2.0';
    const solver = new Reconstructor();
    clip.frames = Array.from({ length: 63 }, (_, i) => {
      const phase = i / 62, palm = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phase * .6));
      const d = articulatedDetection({ timestamp: i * 1000 / 30, flex: [.2 + phase * .3, .3, .2], spread: .1, palm });
      for (const [wrist, index] of [[15, 0], [16, 1]]) {
        d.bodyWorld[wrist].z = -.04 * Math.sin(phase * Math.PI);
        d.bodyWorld[wrist].y -= .03 * phase;
        d.body[wrist].y -= .02 * phase;
        d.hands[index].image[0] = { ...d.body[wrist] };
      }
      return solver.reconstruct(d);
    });
    bytes = Buffer.from(JSON.stringify(clip));
  } else { bytes = await readFile(input); clip = importMotion(bytes.toString()); }
  const snapshot = JSON.stringify(clip), coldStart = performance.now(), enhanced = reconstructTemporal(clip), coldMs = performance.now() - coldStart;
  const baselineTimes = [], temporalTimes = [];
  for (let run = 0; run < 20; run++) {
    const solver = new Reconstructor(), start = performance.now();
    clip.frames.forEach(f => solver.reconstruct(f)); baselineTimes.push(performance.now() - start);
    const temporalStart = performance.now(); reconstructTemporal(clip); temporalTimes.push(performance.now() - temporalStart);
  }
  const asyncStart = performance.now(); await reconstructTemporalAsync(clip); const asyncWallMs = performance.now() - asyncStart;
  const timing = times => { const sorted = [...times].sort((a, b) => a - b); return { medianMs: sorted[10], p95Ms: sorted[18] }; };
  const thresholds = args.includes('--thresholds') ? [100, 125, 150] : [150];
  const controlled = {};
  for (const maxGapMs of thresholds) controlled[maxGapMs] = {
    hand: controlledOcclusion(clip, 'hand', maxGapMs),
    handAndWrist: controlledOcclusion(clip, 'hand-and-wrist', maxGapMs),
  };
  if (snapshot !== JSON.stringify(clip)) throw new Error('Evaluation mutated the input evidence.');
  const report = {
    format: 'signlingo.temporal-evaluation', version: 1,
    sourceKind: args.includes('--synthetic') ? 'analytic-synthetic-not-KSL' : 'private-detector-observations',
    groundTruth: 'Withheld detector reconstructions are proxies, not calibrated 3D or linguistic ground truth. Real missing frames have no accuracy labels.',
    inputSha256: createHash('sha256').update(bytes).digest('hex'), frames: clip.frames.length,
    algorithm: enhanced.algorithm, baselineVersion: clip.pipeline.version,
    performance: { runs: 20, baseline: timing(baselineTimes), temporal: timing(temporalTimes), coldMs, asyncWallMs,
      derivedJsonBytes: Buffer.byteLength(JSON.stringify(enhanced)), rawClipJsonBytes: Buffer.byteLength(snapshot) },
    summary: temporalSummary(clip, enhanced), controlled,
    unchangedEvidence: true,
    timestampLagMs: Math.max(0, ...enhanced.frames.map((f, i) => Math.abs(f.timestamp - clip.frames[i].timestamp))),
    phaseLagOnRealMissingFramesMs: null,
  };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: output, sourceKind: report.sourceKind, performance: report.performance, summary: report.summary }, null, 2));
} finally { await server.close(); }
