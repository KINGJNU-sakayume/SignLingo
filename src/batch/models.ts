import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODELS } from '../motion/types';

export type LockEntry = { url: string; file: string; sha256: string; bytes: number; recordedAt: string };
export type ModelLock = { format: 'signlingo.model-lock'; version: 1; models: Record<string, LockEntry> };
export const MODEL_NAMES = ['pose', 'hand'] as const;
export type ModelName = typeof MODEL_NAMES[number];

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
const exists = (file: string) => stat(file).then(() => true, () => false);

/**
 * The README's pinned model URLs, cached under `dir` (work/ is git-ignored). The first time a model is obtained
 * its SHA-256 is recorded in models.lock.json; afterwards the cached bytes, and any re-download, must match that
 * record. A mismatch stops the run: replace the lock only deliberately, by deleting it.
 */
export async function ensureModels(dir: string, options: { fetch?: typeof fetch; now?: () => Date; log?: (message: string) => void } = {}): Promise<{ files: Record<ModelName, string>; lock: ModelLock }> {
  const fetcher = options.fetch ?? fetch, log = options.log ?? (() => {});
  await mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, 'models.lock.json');
  const lock: ModelLock = await exists(lockPath) ? JSON.parse(await readFile(lockPath, 'utf8')) : { format: 'signlingo.model-lock', version: 1, models: {} };
  if (lock.format !== 'signlingo.model-lock' || lock.version !== 1) throw new Error(`${lockPath} 형식이 다릅니다.`);
  const files = {} as Record<ModelName, string>;
  for (const name of MODEL_NAMES) {
    const url = MODELS[name], file = path.join(dir, path.basename(new URL(url).pathname)), known = lock.models[name];
    if (known && known.url !== url) throw new Error(`${lockPath}의 ${name} 기록은 다른 URL(${known.url})입니다. 의도한 변경이면 잠금 파일을 지우고 다시 받으세요.`);
    if (!await exists(file)) {
      log(`모델 받는 중: ${url}`);
      const response = await fetcher(url, { redirect: 'error' });
      if (!response.ok) throw new Error(`모델을 받지 못했습니다 (${response.status}): ${url}. 프록시 환경이면 NODE_USE_ENV_PROXY=1을 설정하세요.`);
      const bytes = Buffer.from(await response.arrayBuffer()), digest = createHash('sha256').update(bytes).digest('hex');
      if (known && known.sha256 !== digest) throw new Error(`${name} 모델 해시가 기록과 다릅니다: 기록 ${known.sha256}, 받은 파일 ${digest}. 파일을 저장하지 않았습니다.`);
      await writeFile(file + '.partial', bytes);
      await rename(file + '.partial', file);
    }
    const digest = await sha256File(file), bytes = (await stat(file)).size;
    if (known) {
      if (known.sha256 !== digest || known.bytes !== bytes) throw new Error(`${file}가 기록된 SHA-256(${known.sha256})과 다릅니다(${digest}). 의도한 변경이 아니면 파일을 지우고 다시 받으세요.`);
    } else {
      lock.models[name] = { url, file: path.basename(file), sha256: digest, bytes, recordedAt: (options.now?.() ?? new Date()).toISOString() };
      log(`${name} 모델 SHA-256 기록: ${digest}`);
    }
    files[name] = file;
  }
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { files, lock };
}

/** Hashes of the locally installed Tasks Vision WASM files, which are served in place of the CDN copy. */
export async function wasmHashes(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) result[name] = await sha256File(path.join(dir, name));
  return result;
}
