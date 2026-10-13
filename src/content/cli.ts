import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expressionSchema, STATES, type Expression, type ContentState } from './schema';
import { parseCatalog, reviewSubject, sha256, stateErrors, transition, verifyReviews } from './validation';
import { publicManifest, validatePackage, validatePublic, verifyCompatibility } from './package';
import { importMotion } from '../motion/serialization';

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const [command = 'validate', ...args] = process.argv.slice(2);
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
    if (!directory || !/^private-data\/[a-z0-9-]+$/.test(directory) || !videoPath || !motionPath) throw new Error('prepare private-data/<package> <authorized-video> <Motion-Lab-export>');
    let entry = expressionSchema.parse(await json(path.join(directory, 'entry.json')));
    if (STATES.indexOf(entry.status) < 2 || entry.status === 'published') throw new Error('Source approval must precede preparation');
    const errors = stateErrors(entry); if (errors.length) throw new Error(errors.join(' '));
    const video = await readFile(videoPath), motion = await readFile(motionPath);
    if (await sha256(video) !== entry.source.videoSha256) throw new Error('Video differs from rights approval');
    const clip = importMotion(motion.toString());
    if (clip.source.size !== video.length || clip.source.name !== path.basename(videoPath)) throw new Error('Motion Lab export does not match the source video');
    const uri = `content/assets/${entry.id}/v${entry.revision}/reference.motion.json`;
    entry = { ...entry, status: 'reconstruction-review-required', reconstructionVersion: clip.pipeline.version,
      assets: { ...entry.assets, motion: { uri, sha256: await sha256(motion), bytes: motion.length, mediaType: 'application/json', version: entry.revision } },
      reviews: { reconstruction: { status: 'pending' }, linguistic: { status: 'pending' } } };
    await mkdir(path.dirname(path.join(directory, uri)), { recursive: true });
    await copyFile(motionPath, path.join(directory, uri));
    await validatePackage({ schema: 'signlingo.content', version: 1, updatedAt: entry.updatedAt,
      lessons: [{ id: entry.lessonId, title: '검수', category: '검수', description: '검수', order: 0 }], expressions: [entry] }, directory, true);
    await save(path.join(directory, 'entry.json'), entry);
    const diagnostics = {
      subjectSha256: await reviewSubject(entry), frames: clip.frames.length,
      missingHands: Object.fromEntries((['left', 'right'] as const).map(side => [side, clip.frames.filter(f => f.pose.quality[`${side}State`] !== 'tracked').map(f => f.timestamp)])),
      warnings: clip.frames.filter(f => f.warnings.length).map(f => ({ timestamp: f.timestamp, warnings: f.warnings })),
      corrections: clip.frames.filter(f => f.corrections.length).map(f => ({ timestamp: f.timestamp, corrections: f.corrections })),
      reminder: '원본과 비교하고 손·관절·비수지 신호를 검수하세요. 진단 수치가 언어 검수를 대신하지 않습니다.',
    };
    await save(path.join(directory, 'inspection.json'), diagnostics);
    console.log('검수 패키지를 준비했습니다. 원본은 공개 폴더에 복사하지 않았습니다.');
  } else if (command === 'subject') {
    const entry = expressionSchema.parse(await json(args[0]));
    console.log(await reviewSubject(entry));
  } else if (command === 'transition') {
    const [file, next] = args;
    const entry = transition(expressionSchema.parse(await json(file)), next as ContentState);
    await verifyReviews(entry);
    await save(file, entry);
  } else if (command === 'publish') {
    const [directory] = args;
    if (!directory || !/^private-data\/[a-z0-9-]+$/.test(directory)) throw new Error('publish private-data/<package>');
    const entry = expressionSchema.parse(await json(path.join(directory, 'entry.json')));
    if (entry.status !== 'ready-to-publish') throw new Error('Complete both reviews before publishing');
    const published = transition(entry, 'published');
    const catalog = parseCatalog(await json('src/content/catalog.json'));
    await validatePublic(catalog, 'public', await json('public/content/releases.json'));
    const old = catalog.expressions.find(e => e.id === entry.id);
    if (!old) throw new Error('Register the candidate in the catalog first');
    if (old.status === 'published' && entry.revision <= old.revision) throw new Error('Published revisions are immutable; increment revision');
    const next = parseCatalog({ ...catalog, expressions: catalog.expressions.map(e => e.id === entry.id ? published : e) });
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
    console.log('정적 공개 패키지 생성 완료. 변경 내용을 검토한 뒤 PR로 제출하세요.');
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
