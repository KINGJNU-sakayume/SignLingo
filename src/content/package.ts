import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseCatalog, sha256, verifyReviews } from './validation';
import { parseLessonMotion, verifyAsset } from './assets';
import type { Catalog, Expression } from './schema';
import { expressionSchema } from './schema';

export async function readContained(root: string, relative: string) {
  const base = await realpath(root), target = await realpath(path.resolve(root, relative));
  if (!target.startsWith(base + path.sep)) throw new Error('Asset escapes package directory');
  return new Uint8Array(await readFile(target));
}
export async function validatePackage(catalog: Catalog, root: string, includeDrafts = false, evidenceRoot = '.') {
  parseCatalog(catalog);
  for (const entry of catalog.expressions) {
    await verifyReviews(entry);
    for (const evidence of [entry.license.approval, ...Object.values(entry.reviews).filter(r => r.status === 'approved').map(r => r.evidence)]) {
      if (evidence && await sha256(await readContained(evidenceRoot, evidence.document.path)) !== evidence.document.sha256) throw new Error('Review/permission evidence document is missing or has changed');
    }
    if (!includeDrafts && entry.status !== 'published') continue;
    for (const [kind, asset] of Object.entries(entry.assets)) {
      // External hosts are checked explicitly at release time, never fetched by CI.
      if (asset.uri.startsWith('https://')) {
        if (kind === 'motion') throw new Error('Keep reviewed MotionClips on the static site for reliable practice');
        continue;
      }
      const bytes = await readContained(root, asset.uri);
      await verifyAsset(asset, bytes);
      if (kind === 'motion') parseLessonMotion(entry, bytes);
    }
  }
}
/**
 * Top-level release date for a publish: the operator's local calendar day, never earlier than the
 * published entry or the previous catalog (a KST morning is still the previous day in UTC).
 */
export function releaseDate(now: Date, ...dates: string[]) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return [local, ...dates].sort().at(-1)!;
}
export function publicManifest(catalog: Catalog): Catalog {
  return { ...catalog, expressions: catalog.expressions.filter(e => e.status === 'published') };
}
export async function publicFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string) {
    for (const file of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, file.name);
      if (file.isSymbolicLink()) throw new Error('Public content must not contain symbolic links');
      if (file.isDirectory()) await visit(relative); else result.push(relative);
    }
  }
  await visit('content'); return result;
}
export async function validatePublic(catalog: Catalog, root: string, releases: Expression[], evidenceRoot = '.') {
  for (const entry of releases) {
    if (entry.status !== 'published') throw new Error('Release archive must contain published entries');
    await validatePackage({ ...catalog, expressions: [entry] }, root, false, evidenceRoot);
  }
  await validatePackage(catalog, root, false, evidenceRoot);
  const allowed = new Set(['content/manifest.json', 'content/releases.json']);
  for (const entry of [...catalog.expressions.filter(e => e.status === 'published'), ...releases]) {
    for (const asset of Object.values(entry.assets)) if (!asset.uri.startsWith('https://')) allowed.add(asset.uri);
  }
  for (const file of await publicFiles(root)) if (!allowed.has(file)) throw new Error(`Unapproved public file: ${file}`);
}
export function verifyCompatibility(previous: Expression[], current: Expression[]) {
  for (const entry of previous) {
    const retained = current.find(item => item.id === entry.id && item.revision === entry.revision);
    if (!retained || JSON.stringify(expressionSchema.parse(retained)) !== JSON.stringify(expressionSchema.parse(entry))) throw new Error(`Published revision removed or modified: ${entry.id} v${entry.revision}`);
  }
}
