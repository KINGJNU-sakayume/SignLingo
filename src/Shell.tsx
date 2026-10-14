import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import MotionLab from './App';
import { PracticeMode } from './practice/PracticeMode';
import { LessonDetail } from './lessons/LessonDetail';
import { LocalLessonLab } from './lessons/LocalLessonLab';
import { readProgress, saveProgress, progressKey, recordPractice, type LessonProgress } from './lessons/catalog';
import type { Catalog, Expression } from './content/schema';
import type { MotionClip } from './motion/types';
import { ChunkyButton } from './design/ChunkyButton';
import { Mascot } from './design/Mascot';
import { AppNav, TopBar, type NavMode } from './learn/AppNav';
import { Guidebook } from './learn/Guidebook';
import { LessonComplete, UnitComplete } from './learn/LessonComplete';
import { LessonPlayer } from './learn/LessonPlayer';
import { buildPath, type PathNodeModel, type UnitModel } from './learn/path';
import { PathView } from './learn/PathView';
import { dueExpressions } from './learn/review';
import { REVIEW_TARGETS, ReviewView, RightRail } from './learn/ReviewView';
import { applySession, buildLessonSession, buildReviewSession, currentStep, sessionSummary, startSession, type CameraResult, type Plan, type SessionState } from './learn/session';
import { playCue } from './learn/sound';
import { publishedSource, type ContentSource } from './learn/source';
import { readLearnStore, saveLearnStore } from './learn/storage';
import './design/tokens.css';
import './design/components.css';
import './shell.css';
import './learn/learn.css';

const LESSON_ID = 'first-expression';
const EMPTY: LessonProgress = { viewed: false, attempts: 0 };
type Mode = NavMode | 'local';
type View = { name: 'path' } | { name: 'guidebook'; unitId: string } | { name: 'card'; expressionId: string; back: { label: string; to: 'guidebook' | 'review'; unitId: string } };
type Lesson = { session: SessionState; clips: Record<string, MotionClip> | null; status: 'loading' | 'error' | 'playing' | 'complete' | 'unit-complete';
  attempt: number; returnTo: Mode; summary?: ReturnType<typeof sessionSummary>; unit?: UnitModel };
type Guided = { kind: 'card' | 'lesson' | 'local'; entry?: Expression; clip: MotionClip; key: number };

function demoRequested() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';
}
function reviewRequested() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('review') === '1';
}
const stepExpressions = (plan: Plan) => [...new Set(plan.steps.flatMap(step => 'options' in step ? step.options : step.kind === 'same-different' ? [step.target, step.other] : [step.target]))];

/** Resolves the content source. The demo and review-preview sources exist only in development builds. */
export default function Shell() {
  const [source, setSource] = useState<ContentSource | null>(() => demoRequested() || reviewRequested() ? null : publishedSource);
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (demoRequested()) void import('./dev/demoSource').then(module => setSource(module.demoSource));
      else if (reviewRequested()) void import('./dev/reviewSource').then(module => setSource(module.reviewSource));
    }
  }, []);
  if (!source) return <p className="sl-root sl-boot" role="status">준비하는 중이에요…</p>;
  return <AppShell source={source} />;
}

function AppShell({ source }: { source: ContentSource }) {
  const [mode, setMode] = useState<Mode>('learn');
  const [view, setView] = useState<View>({ name: 'path' });
  const [catalog, setCatalog] = useState<Catalog | null>(null), [catalogError, setCatalogError] = useState(false), [catalogRetry, setCatalogRetry] = useState(0);
  const [progress, setProgress] = useState(() => readProgress(source.storage.progress));
  const [store, setStore] = useState(() => readLearnStore(source.storage.learn));
  const [now, setNow] = useState(() => new Date());
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [guided, setGuided] = useState<Guided | null>(null);
  const [cameraReturn, setCameraReturn] = useState<CameraResult | null>(null);
  const [celebrate, setCelebrate] = useState<string[]>([]);
  const [reference, setReference] = useState<MotionClip | null>(null);
  const [clipCache] = useState(() => new Map<string, MotionClip>());
  useEffect(() => {
    if (!source.banner) return;
    document.documentElement.classList.add('sl-has-band');
    return () => document.documentElement.classList.remove('sl-has-band');
  }, [source]);
  useEffect(() => saveProgress(progress, source.storage.progress), [progress, source]);
  useEffect(() => saveLearnStore(store, source.storage.learn), [store, source]);
  useEffect(() => {
    const controller = new AbortController(); setCatalogError(false);
    source.loadCatalog(controller.signal).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(() => { if (!controller.signal.aborted) { setCatalog(null); setCatalogError(true); } });
    return () => controller.abort();
  }, [source, catalogRetry]);
  useEffect(() => {
    if (!celebrate.length) return;
    const timer = window.setTimeout(() => setCelebrate([]), 1400);
    return () => window.clearTimeout(timer);
  }, [celebrate]);
  const entries = useMemo(() => new Map(catalog?.expressions.map(e => [e.id, e]) ?? []), [catalog]);
  const path = useMemo(() => catalog ? buildPath(catalog, store, now) : null, [catalog, store, now]);
  const due = useMemo(() => catalog ? dueExpressions(store, catalog.expressions, now) : [], [catalog, store, now]);
  const sound = store.settings.sound;
  const toggleSound = () => setStore(old => ({ ...old, settings: { ...old.settings, sound: !old.settings.sound } }));

  const record = (key: string, update: (p: LessonProgress) => LessonProgress) => setProgress(old => ({ ...old, [key]: update(old[key] ?? EMPTY) }));
  const markViewed = (entry: Expression) => record(progressKey(entry), p => ({ ...p, viewed: true }));
  const navigate = (next: NavMode) => {
    if (next === 'practice') setGuided(null);
    if (next === 'learn') setView({ name: 'path' });
    setNow(new Date()); setMode(next);
  };

  // Lessons ---------------------------------------------------------------------------------
  function begin(plan: Plan, returnTo: Mode) {
    setCameraReturn(null);
    setLesson({ session: startSession(plan), clips: null, status: 'loading', attempt: 0, returnTo });
  }
  function startNode(node: PathNodeModel, kind: 'lesson' | 'review') {
    if (!catalog || !path) return;
    const targets = node.expressions.map(id => entries.get(id)).filter((e): e is Expression => !!e);
    if (kind === 'lesson') return begin(buildLessonSession(node.id, targets, catalog, Math.random), 'learn');
    const dueNow = dueExpressions(store, targets, now);
    if (node.kind === 'review') {
      // Due expressions first; then the least practised ones, so the path never waits a day.
      const box = (e: Expression) => store.expressions[progressKey(e)]?.box ?? 0;
      const rest = targets.filter(e => !dueNow.includes(e)).sort((a, b) => box(a) - box(b));
      return begin(buildReviewSession(node.id, [...dueNow, ...rest].slice(0, REVIEW_TARGETS), catalog, Math.random), 'learn');
    }
    begin(buildReviewSession(null, (dueNow.length ? dueNow : targets).slice(0, REVIEW_TARGETS), catalog, Math.random), 'learn');
  }
  useEffect(() => {
    if (!lesson || lesson.status !== 'loading') return;
    const controller = new AbortController();
    const ids = stepExpressions(lesson.session.plan);
    Promise.all(ids.map(async id => {
      const entry = entries.get(id); if (!entry) throw new Error('missing expression');
      const key = progressKey(entry);
      const clip = clipCache.get(key) ?? await source.loadMotion(entry, controller.signal);
      clipCache.set(key, clip); return [id, clip] as const;
    })).then(pairs => { if (!controller.signal.aborted) setLesson(old => old && { ...old, clips: Object.fromEntries(pairs), status: 'playing' }); })
      .catch(() => { if (!controller.signal.aborted) setLesson(old => old && { ...old, status: 'error' }); });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.status, lesson?.attempt]);
  const finishSession = useCallback((final: SessionState) => {
    if (!catalog) return;
    const at = new Date(), before = buildPath(catalog, store, at);
    const next = applySession(store, final, catalog, at), after = buildPath(catalog, next, at);
    const unitId = final.plan.unitId;
    const newlyDone = !before.units.find(u => u.id === unitId)?.completed && after.units.find(u => u.id === unitId)?.completed;
    setStore(next); setNow(at);
    setLesson(old => old && { ...old, session: final, status: 'complete', summary: sessionSummary(final, at.getTime()), unit: newlyDone ? after.units.find(u => u.id === unitId) : undefined });
    playCue('complete', store.settings.sound);
  }, [catalog, store]);
  function closeLesson() {
    if (!lesson || !catalog) return;
    const nodeId = lesson.session.plan.nodeId, after = buildPath(catalog, store, new Date());
    const celebrateIds = [nodeId, after.current?.id, ...(lesson.unit ? [`trophy:${lesson.unit.id}`] : [])].filter((id): id is string => !!id);
    setLesson(null); setCameraReturn(null); setNow(new Date());
    setMode(lesson.returnTo); if (lesson.returnTo === 'learn') setView({ name: 'path' });
    if (lesson.status !== 'playing') setCelebrate(celebrateIds);
  }

  // Practice round trips ------------------------------------------------------------------------
  function practiceResult(evidence: 'sufficient' | 'limited', feedback: string[] = []) {
    if (!guided) return;
    record(guided.entry ? progressKey(guided.entry) : LESSON_ID, p => recordPractice(p, evidence, feedback));
    if (guided.kind === 'lesson' && lesson) {
      const step = currentStep(lesson.session);
      if (step?.kind === 'camera') setCameraReturn({ stepId: step.id, evidence, feedback: feedback.slice(0, 3) });
    }
    returnFromPractice();
  }
  function returnFromPractice() {
    if (!guided) return;
    if (guided.kind === 'card') setMode('learn');
    if (guided.kind === 'local') setMode('local');
    setGuided(null);
  }
  const practice = (kind: Guided['kind'], clip: MotionClip, entry?: Expression) => setGuided({ kind, clip, entry, key: Date.now() });
  const practiceView = <PracticeMode key={guided ? `guided-${guided.key}` : 'free'} initialReference={guided?.clip ?? null}
    onResultReviewed={guided ? practiceResult : undefined} onReturnToLesson={guided ? returnFromPractice : undefined} />;

  // Views -------------------------------------------------------------------------------------
  const banner = source.banner && <p className="sl-root sl-demo-band" role="note">{source.banner}</p>;
  const unit = path && view.name === 'guidebook' ? path.units.find(u => u.id === view.unitId) : undefined;
  const cardEntry = view.name === 'card' ? entries.get(view.expressionId) : undefined;
  const learnContent = catalogError
    ? <div className="sl-root sl-state" role="alert"><Mascot mood="oops" size={96} /><p>학습 목록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</p>
      <ChunkyButton variant="secondary" onClick={() => setCatalogRetry(v => v + 1)}><RotateCcw size={20} strokeWidth={2.5} aria-hidden="true" />다시 시도</ChunkyButton></div>
    : !catalog || !path ? <div className="sl-root sl-state" role="status"><Mascot mood="thinking" size={96} /><p>학습 경로를 불러오는 중이에요…</p></div>
      : view.name === 'card' && cardEntry ? <LessonDetail key={cardEntry.id} entry={cardEntry} source={source} progress={progress} backLabel={view.back.label}
        onBack={() => view.back.to === 'review' ? (setView({ name: 'path' }), setMode('review')) : setView({ name: 'guidebook', unitId: view.back.unitId })}
        onViewed={() => markViewed(cardEntry)} onPractice={clip => { practice('card', clip, cardEntry); setMode('practice'); }} />
        : view.name === 'guidebook' && unit ? <Guidebook unit={unit} onBack={() => setView({ name: 'path' })}
          onOpen={id => setView({ name: 'card', expressionId: id, back: { label: '가이드북', to: 'guidebook', unitId: unit.id } })} />
          : <PathView path={path} catalog={catalog} celebrate={celebrate} onStart={startNode} onGuidebook={unitId => setView({ name: 'guidebook', unitId })} />;
  const topTitle = mode === 'review' ? '복습' : path?.current ? `단원 ${path.units.find(u => u.id === path.current!.unitId)?.number} · ${path.units.find(u => u.id === path.current!.unitId)?.title}` : '한국수어 학습';

  let lessonLayer = null;
  if (lesson) {
    const { status, session } = lesson;
    lessonLayer = guided?.kind === 'lesson' ? <div className="sl-lesson-practice">{practiceView}</div>
      : status === 'loading' ? <div className="sl-root sl-state is-full" role="status"><Mascot mood="thinking" size={120} /><p>레슨을 준비하고 있어요…</p></div>
        : status === 'error' ? <div className="sl-root sl-state is-full" role="alert"><Mascot mood="oops" size={120} />
          <p>시범 자료를 불러오거나 검증하지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>
          <ChunkyButton onClick={() => setLesson(old => old && { ...old, status: 'loading', attempt: old.attempt + 1 })}><RotateCcw size={20} strokeWidth={2.5} aria-hidden="true" />다시 시도</ChunkyButton>
          <ChunkyButton variant="ghost" onClick={closeLesson}>경로로 돌아가기</ChunkyButton></div>
          : status === 'playing' && catalog && lesson.clips ? <LessonPlayer session={session} catalog={catalog} clips={lesson.clips} sound={sound} cameraReturn={cameraReturn}
            onSession={next => setLesson(old => old && { ...old, session: next })} onToggleSound={toggleSound}
            onViewed={id => { const entry = entries.get(id); if (entry) markViewed(entry); }}
            onCamera={id => { const entry = entries.get(id), clip = lesson.clips?.[id]; if (entry && clip) practice('lesson', clip, entry); }}
            onCameraAcknowledged={() => setCameraReturn(null)} onExit={closeLesson} onFinish={finishSession} />
            : status === 'complete' && lesson.summary ? <LessonComplete kind={session.plan.kind} summary={lesson.summary}
              onContinue={() => lesson.unit ? setLesson(old => old && { ...old, status: 'unit-complete' }) : closeLesson()} />
              : lesson.unit ? <UnitComplete number={lesson.unit.number} title={lesson.unit.title} onContinue={closeLesson} /> : null;
  }

  const active: NavMode = mode === 'local' ? 'lab' : mode;
  return <>
    {banner}
    <div className={`sl-shell${banner ? ' has-banner' : ''}`} data-mode={mode} hidden={!!lesson}>
      <AppNav active={active} dueCount={due.length} sound={sound} onNavigate={navigate} onToggleSound={toggleSound} />
      <div className="sl-content">
        {(mode === 'learn' || mode === 'review') && <TopBar title={topTitle} sound={sound} onToggleSound={toggleSound} />}
        {mode === 'learn' && <div className={`sl-root sl-learn${view.name === 'path' ? ' is-path' : ''}`}>
          <main className="sl-learn-main">{learnContent}</main>
          {catalog && <RightRail catalog={catalog} store={store} now={now} onStart={targets => begin(buildReviewSession(null, targets, catalog, Math.random), 'learn')} />}
        </div>}
        {mode === 'review' && (catalog ? <ReviewView catalog={catalog} store={store} now={now}
          onStart={targets => begin(buildReviewSession(null, targets, catalog, Math.random), 'review')}
          onOpen={entry => { setView({ name: 'card', expressionId: entry.id, back: { label: '복습', to: 'review', unitId: entry.lessonId } }); setMode('learn'); }} />
          : <main className="sl-root sl-learn-main">{learnContent}</main>)}
        {mode === 'local' && <><p className="operator-note">운영자용 로컬 점검 · 선택한 파일은 공개 레슨에 등록되지 않습니다.</p>
          <LocalLessonLab reference={reference} progress={progress[LESSON_ID] ?? EMPTY}
            onReference={clip => { setReference(clip); record(LESSON_ID, () => ({ ...EMPTY })); }}
            onViewed={() => record(LESSON_ID, p => ({ ...p, viewed: true }))}
            onPractice={() => { if (reference) { practice('local', reference); setMode('practice'); } }} /></>}
        <div hidden={mode !== 'lab'}><MotionLab active={mode === 'lab'} />
          <section className="operator-note"><h2>학습 콘텐츠 준비</h2><p>영상별 이용 허락을 등록한 뒤 원본과 복원 결과를 비교하세요. 손목 보정과 기술 진단 후 별도의 한국수어 검수가 필요합니다.</p>
            <button className="button secondary" onClick={() => setMode('local')}>로컬 자료로 학습 흐름 점검</button></section></div>
        {mode === 'practice' && guided?.kind !== 'lesson' && practiceView}
      </div>
    </div>
    {lessonLayer}
  </>;
}
