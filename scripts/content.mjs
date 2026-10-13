// Bundle the shared TypeScript validators using the existing Vite dependency.
import { build } from 'vite';
await build({ configFile: false, logLevel: 'error', build: { ssr: 'src/content/cli.ts', outDir: 'work/content-tool', emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'cli.mjs' } } } });
await import('../work/content-tool/cli.mjs');
