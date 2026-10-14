// Bundle the batch CLI (TypeScript, shared motion modules) using the existing Vite dependency, then run it.
// Commands: batch | compare | report. See docs/MOTION_BATCH.md.
import { build } from 'vite';
await build({ configFile: false, logLevel: 'error', build: { ssr: 'src/batch/cli.ts', outDir: 'work/motion-tool/cli', emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'cli.mjs' } } } });
await import('../work/motion-tool/cli/cli.mjs');
