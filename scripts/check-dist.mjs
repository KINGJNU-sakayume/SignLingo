// Fails when development-only demo or review-preview content leaks into the production build.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MARKERS = ['SIGNLINGO_DEMO_CONTENT', '데모 동작', 'signlingo.demo.', 'demoSource', 'SIGNLINGO_REVIEW_PREVIEW', 'signlingo.review.', 'reviewSource', 'private-data/'];
const root = process.argv[2] ?? 'dist';
async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(full); else yield full;
  }
}
const found = [];
let scanned = 0;
for await (const file of files(root)) {
  if (!/\.(js|mjs|css|html|json|map)$/.test(file)) continue;
  scanned++;
  const text = await readFile(file, 'utf8');
  for (const marker of MARKERS) if (text.includes(marker)) found.push(`${file}: ${marker}`);
}
if (!scanned) { console.error(`No build output found in ${root}`); process.exit(1); }
if (found.length) { console.error('Development demo content found in the production build:\n' + found.join('\n')); process.exit(1); }
console.log(`Production build checked: ${scanned} files, no demo content.`);
