import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expressionSchema, STATES, type Expression, type ContentState } from './schema';
import { parseCatalog, reviewSubject, sha256, stateErrors, transition, verifyReviews } from './validation';
import { publicManifest, readContained, releaseDate, validatePackage, validatePublic, verifyCompatibility } from './package';
import { verifyAsset } from './assets';
import { exportMotion, importMotion } from '../motion/serialization';
import { applyConstraints, exportConstraints, parseConstraints, verifyConstraintRecord } from '../motion/constraints';
import type { MotionClip } from '../motion/types';

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const [command = 'validate', ...args] = process.argv.slice(2);
const PACKAGE = /^private-data\/[a-z0-9-]+$/;

/**
 * The reviewed-motion candidate of a package: writes the motion asset (never under public/), resets both reviews,
 * records the applied constraints (part of the review subject) and regenerates inspection.json.
 */
async function writePrepared(directory: string, prepared: Expression, clip: MotionClip, motion: Uint8Array) {
  await verifyConstraintRecord(clip);
  const uri = `content/assets/${prepared.id}/v${prepared.revision}/reference.motion.json`;
  const { constraints: _previous, ...rest } = prepared;
  const entry: Expression = { ...rest, status: 'reconstruction-review-required', reconstructionVersion: clip.pipeline.version,
    ...(clip.constraints ? { constraints: { sha256: clip.constraints.sha256, count: clip.constraints.document.constraints.length } } : {}),
    assets: { ...prepared.assets, motion: { uri, sha256: await sha256(motion), bytes: motion.length, mediaType: 'application/json', version: prepared.revision } },
    reviews: { reconstruction: { status: 'pending' }, linguistic: { status: 'pending' } } };
  await mkdir(path.dirname(path.join(directory, uri)), { recursive: true });
  await writeFile(path.join(directory, uri), motion);
  await validatePackage({ schema: 'signlingo.content', version: 1, updatedAt: entry.updatedAt,
    lessons: [{ id: entry.lessonId, title: '검수', category: '검수', description: '검수', order: 0 }], expressions: [entry] }, directory, true);
  await save(path.join(directory, 'entry.json'), entry);
  const changed = clip.frames.flatMap((f, i) => f.constraint ? [i] : []);
  const diagnostics = {
    subjectSha256: await reviewSubject(entry), revision: entry.revision, frames: clip.frames.length,
    missingHands: Object.fromEntries((['left', 'right'] as const).map(side => [side, clip.frames.filter(f => f.pose.quality[`${side}State`] !== 'tracked').map(f => f.timestamp)])),
    warnings: clip.frames.filter(f => f.warnings.length).map(f => ({ timestamp: f.timestamp, warnings: f.warnings })),
    corrections: clip.frames.filter(f => f.corrections.length).map(f => ({ timestamp: f.timestamp, corrections: f.corrections })),
    ...(clip.constraints ? { constraints: {
      sha256: clip.constraints.sha256, count: clip.constraints.document.constraints.length, changedFrames: changed.length,
      changedJoints: [...new Set(changed.flatMap(i => clip.frames[i].constraint!.joints))].sort(),
      constrainedHands: Object.fromEntries((['left', 'right'] as const).map(side => [side, changed.filter(i => clip.frames[i].constraint!.evidence[side] === 'constrained').map(i => clip.frames[i].timestamp)])),
      residuals: clip.constraints.summary.constraints,
      notes: clip.constraints.document.constraints.map(c => ({ id: c.id, kind: c.kind, note: c.note })),
    } } : {}),
    reminder: clip.constraints
      ? '제약 조건으로 보정한 동작입니다. 보정 전후를 원본 영상과 비교하고, 관측 없이 만든 값(constrained)과 손·관절·비수지 신호를 검수하세요. 진단 수치가 언어 검수를 대신하지 않습니다.'
      : '원본과 비교하고 손·관절·비수지 신호를 검수하세요. 진단 수치가 언어 검수를 대신하지 않습니다.',
  };
  await save(path.join(directory, 'inspection.json'), diagnostics);
  return entry;
}

/** Validates a ready-to-publish package and copies its approved assets into the static release (never a video). */
async function publishPackage(directory: string | undefined) {
  if (!directory || !/^private-data\/[a-z0-9-]+$/.test(directory)) throw new Error('publish private-data/<package>');
  const entry = expressionSchema.parse(await json(path.join(directory, 'entry.json')));
  if (entry.status !== 'ready-to-publish') throw new Error('Complete both reviews before publishing');
  const published = transition(entry, 'published');
  const catalog = parseCatalog(await json('src/content/catalog.json'));
  await validatePublic(catalog, 'public', await json('public/content/releases.json'));
  const old = catalog.expressions.find(e => e.id === entry.id);
  if (!old) throw new Error('Register the candidate in the catalog first');
  if (old.status === 'published' && entry.revision <= old.revision) throw new Error('Published revisions are immutable; increment revision');
  // The catalog and its generated manifest record when this release was made; published entries stay immutable.
  const next = parseCatalog({ ...catalog, updatedAt: releaseDate(new Date(), published.updatedAt, catalog.updatedAt),
    expressions: catalog.expressions.map(e => e.id === entry.id ? published : e) });
  await validatePackage({ ...next, expressions: [published] }, directory);
  // Every validation, including external media availability, completes before any public copy.
  for (const asset of Object.values(published.assets)) {
    if (asset.uri.startsWith('https://')) {
      const response = await fetch(asset.uri, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('access-control-allow-origin')) throw new Error('External host requires stable HTTPS and CORS');
      const { verifyAsset } = await import('./assets');
      await verifyAsset(asset, new Uint8Array(await response.arrayBuffer()));
    } else {
      try { await access(path.join('public', asset.uri)); throw new Error('Asset version already exists; use a new revision'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  const releases: Expression[] = await json('public/content/releases.json');
  if (old.status === 'published') releases.push(old);
  for (const asset of Object.values(published.assets)) if (!asset.uri.startsWith('https://')) {
    await mkdir(path.dirname(path.join('public', asset.uri)), { recursive: true });
    await copyFile(path.join(directory, asset.uri), path.join('public', asset.uri));
  }
  await save('src/content/catalog.json', next);
  await save('public/content/releases.json', releases);
  await save('public/content/manifest.json', publicManifest(next));
}

/**
 * `approve [--date YYYY-MM-DD] [--publish] --feedback "<owner's words>" private-data/<package>...`
 * Under the review rule (docs/content-reviews/review-process.md), the repository owner's approving feedback on a
 * candidate is the result of both reviews. This writes one review record for the packages (subject, motion and
 * constraint hashes computed here, never typed by hand), approves both reviews against it, moves each package to
 * ready-to-publish and, with --publish, publishes it. The current revision comes from the package itself.
 */
async function approve(argv: string[]) {
  let feedback = '', date = new Date().toISOString().slice(0, 10), publish = false;
  const packages: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--feedback') feedback = argv[++i] ?? '';
    else if (argv[i] === '--date') date = argv[++i] ?? '';
    else if (argv[i] === '--publish') publish = true;
    else packages.push(argv[i]);
  }
  if (!feedback.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !packages.length || !packages.every(p => PACKAGE.test(p))) {
    throw new Error('approve [--date YYYY-MM-DD] [--publish] --feedback "<검토자 피드백>" private-data/<package>...');
  }
  const reviewers = await json('src/content/reviewers.json') as { rule: string } & Record<'reconstruction' | 'linguistic', { reviewer: string; qualification: string }>;
  const entries = await Promise.all(packages.map(async directory => expressionSchema.parse(await json(path.join(directory, 'entry.json')))));
  for (const entry of entries) {
    if (entry.status !== 'reconstruction-review-required' && entry.status !== 'linguistic-review-required') throw new Error(`${entry.id}: 검수 대기 상태가 아닙니다(${entry.status}).`);
    const errors = stateErrors(entry); if (errors.length) throw new Error(`${entry.id}: ${errors.join(' ')}`);
  }
  // One record per review session: docs/content-reviews/review-<date>[-n].md
  let n = 1, file = '';
  for (;; n++) {
    file = `docs/content-reviews/review-${date}${n > 1 ? `-${n}` : ''}.md`;
    try { await access(file); } catch { break; }
  }
  const reference = `SL-REV-${date}${n > 1 ? `-${n}` : ''}`;
  const rows = await Promise.all(entries.map(async entry => `| ${entry.id} (${entry.displayName}) | ${entry.revision} | ${await reviewSubject(entry)} | ${entry.assets.motion?.sha256 ?? '-'} | ${entry.constraints ? `${entry.constraints.sha256} (${entry.constraints.count})` : '-'} | ${entry.reconstructionVersion ?? '-'} |`));
  const record = [
    `# 검수 기록 ${reference}`, '',
    '`npm run content -- approve`가 만든 기록입니다. 대상 해시는 명령이 계산했습니다.', '',
    `- 검수일: ${date}`,
    `- 근거 규칙: [검수 규칙](${path.basename(reviewers.rule)}). 저장소 소유자의 승인 피드백은 소유자와 검수자가 함께 본 두 검수의 결과입니다.`,
    `- 3D 복원 검수: ${reviewers.reconstruction.reviewer} · ${reviewers.reconstruction.qualification}`,
    `- 한국수어 검수: ${reviewers.linguistic.reviewer} · ${reviewers.linguistic.qualification}`,
    '- 결정: **승인** (아래 대상 해시). 설명·변이·자산·제약 조건이 바뀌면 승인은 무효가 됩니다.', '',
    '## 피드백 원문', '', ...feedback.trim().split('\n').map(line => `> ${line}`), '',
    '## 대상', '',
    '| 표현 | 개정판 | 대상 해시 | 동작 파일 SHA-256 | 제약 조건 SHA-256 (개수) | 복원 버전 |',
    '| --- | --- | --- | --- | --- | --- |', ...rows, '',
  ].join('\n');
  await writeFile(file, record);
  const document = { path: file, sha256: await sha256(new TextEncoder().encode(record)) };
  const notes = feedback.trim().replace(/\s+/g, ' ').slice(0, 1000);
  for (const [k, original] of entries.entries()) {
    const subjectSha256 = await reviewSubject(original);
    const evidence = (role: 'reconstruction' | 'linguistic') => ({ ...reviewers[role], date, reference, notes, document });
    let entry: Expression = { ...original, reviews: { ...original.reviews, reconstruction: { status: 'approved', evidence: evidence('reconstruction'), subjectSha256 } } };
    if (entry.status === 'reconstruction-review-required') entry = transition(entry, 'linguistic-review-required');
    entry = transition({ ...entry, reviews: { ...entry.reviews, linguistic: { status: 'approved', evidence: evidence('linguistic'), subjectSha256 } } }, 'ready-to-publish');
    await verifyReviews(entry);
    await save(path.join(packages[k], 'entry.json'), entry);
    if (publish) await publishPackage(packages[k]);
    console.log(`${entry.id} 개정판 ${entry.revision}: 두 검수 승인${publish ? ', 공개' : ''} (${file}).`);
  }
}

try {
  if (command === 'register') {
    const [id, directory] = args;
    if (!id || !directory || !/^private-data\/[a-z0-9-]+$/.test(directory)) throw new Error('register <candidate-id> private-data/<package>');
    const catalog = parseCatalog(await json('src/content/catalog.json'));
    const entry = catalog.expressions.find(e => e.id === id);
    if (!entry) throw new Error('Unknown candidate');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'entry.json'), JSON.stringify(entry, null, 2) + '\n', { flag: 'wx' });
    console.log('등록 완료. entry.json에 영상별 이용 허락과 원본 SHA-256을 기록하세요.');
  } else if (command === 'prepare') {
    const [directory, videoPath, motionPath] = args;
    if (!directory || !PACKAGE.test(directory) || !videoPath || !motionPath) throw new Error('prepare private-data/<package> <authorized-video> <Motion-Lab-export>');
    const entry = expressionSchema.parse(await json(path.join(directory, 'entry.json')));
    if (STATES.indexOf(entry.status) < 2 || entry.status === 'published') throw new Error('Source approval must precede preparation');
    const errors = stateErrors(entry); if (errors.length) throw new Error(errors.join(' '));
    const video = await readFile(videoPath), motion = await readFile(motionPath);
    if (await sha256(video) !== entry.source.videoSha256) throw new Error('Video differs from rights approval');
    const clip = importMotion(motion.toString());
    if (clip.source.size !== video.length || clip.source.name !== path.basename(videoPath)) throw new Error('Motion Lab export does not match the source video');
    await writePrepared(directory, entry, clip, motion);
    console.log('검수 패키지를 준비했습니다. 원본은 공개 폴더에 복사하지 않았습니다.');
  } else if (command === 'constrain') {
    const [directory, constraintsPath] = args;
    if (!directory || !PACKAGE.test(directory) || !constraintsPath) throw new Error('constrain private-data/<package> <constraints.json>');
    const entry = expressionSchema.parse(await json(path.join(directory, 'entry.json')));
    if (STATES.indexOf(entry.status) < 2) throw new Error('Source approval must precede constraint correction');
    const errors = stateErrors(entry); if (errors.length) throw new Error(errors.join(' '));
    const asset = entry.assets.motion;
    if (!asset || asset.uri.startsWith('https://')) throw new Error('먼저 prepare로 패키지의 동작 파일을 준비하세요.');
    const set = parseConstraints(await readFile(constraintsPath, 'utf8'));
    if (set.expression && set.expression !== entry.id) throw new Error(`제약 조건의 expression(${set.expression})이 패키지(${entry.id})와 다릅니다.`);
    // The package's motion; a published revision's asset may be read (never written) from public/.
    let motion: Uint8Array;
    try { motion = await readContained(directory, asset.uri); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; motion = await readContained('public', asset.uri); }
    await verifyAsset(asset, motion);
    const { clip } = await applyConstraints(importMotion(new TextDecoder().decode(motion)), set);
    // The catalog, not the private entry, says what is published. A correction never reuses a published revision;
    // an unpublished higher revision (e.g. an earlier constrain) is rebuilt in place.
    const catalog = parseCatalog(await json('src/content/catalog.json'));
    const published = catalog.expressions.find(e => e.id === entry.id && e.status === 'published');
    const revision = published && entry.revision <= published.revision ? published.revision + 1 : entry.revision;
    let next: Expression = { ...entry, revision };
    if (revision !== entry.revision) {
      const assets: Expression['assets'] = {};
      for (const [kind, item] of Object.entries(entry.assets) as [keyof Expression['assets'], NonNullable<Expression['assets']['motion']>][]) {
        if (kind === 'motion') continue;
        if (item.uri.startsWith('https://')) { assets[kind] = { ...item, version: revision }; continue; }
        const uri = item.uri.replace(`/v${entry.revision}/`, `/v${revision}/`);
        const bytes = await readContained(directory, item.uri).catch(() => readContained('public', item.uri));
        await verifyAsset(item, bytes);
        await mkdir(path.dirname(path.join(directory, uri)), { recursive: true });
        await writeFile(path.join(directory, uri), bytes);
        assets[kind] = { ...item, uri, version: revision };
      }
      next = { ...next, assets };
    }
    const written = await writePrepared(directory, next, clip, new TextEncoder().encode(exportMotion(clip)));
    await writeFile(path.join(directory, 'constraints.json'), exportConstraints(set));
    const changed = clip.frames.filter(f => f.constraint).length;
    console.log(`제약 조건 ${set.constraints.length}개를 적용했습니다: revision ${written.revision}, 바뀐 프레임 ${changed}개, 해시 ${clip.constraints!.sha256}.`);
    console.log('두 검수를 다시 받아야 합니다. inspection.json을 확인하세요. 공개 폴더는 바꾸지 않았습니다.');
  } else if (command === 'subject') {
    const entry = expressionSchema.parse(await json(args[0]));
    console.log(await reviewSubject(entry));
  } else if (command === 'transition') {
    const [file, next] = args;
    const entry = transition(expressionSchema.parse(await json(file)), next as ContentState);
    await verifyReviews(entry);
    await save(file, entry);
  } else if (command === 'publish') {
    await publishPackage(args[0]);
    console.log('정적 공개 패키지 생성 완료. 변경 내용을 검토한 뒤 PR로 제출하세요.');
  } else if (command === 'approve') {
    await approve(args);
  } else if (command === 'validate') {
    const catalog = parseCatalog(await json('src/content/catalog.json'));
    const manifest = parseCatalog(await json('public/content/manifest.json'));
    if (JSON.stringify(manifest) !== JSON.stringify(publicManifest(catalog))) throw new Error('Static manifest differs from approved catalog');
    const releases: Expression[] = await json('public/content/releases.json');
    await validatePublic(catalog, 'public', releases);
    // Full checkout in CI supplies origin/main. Missing files are expected only for the Phase 4 migration.
    const base = process.env.CONTENT_BASE_REF || 'origin/main';
    const files = execFileSync('git', ['ls-tree', '--name-only', base, '--', 'public/content/manifest.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    if (files.trim()) {
      const previous = parseCatalog(JSON.parse(execFileSync('git', ['show', `${base}:public/content/manifest.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })));
      const archived: Expression[] = JSON.parse(execFileSync('git', ['show', `${base}:public/content/releases.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
      verifyCompatibility([...previous.expressions, ...archived], [...manifest.expressions, ...releases]);
    }
    console.log(`콘텐츠 검증 완료: 후보 ${catalog.expressions.length}개 / 공개 ${manifest.expressions.length}개`);
  } else throw new Error('Unknown content command');
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
