import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Equal, EqualNot, Info, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { Avatar, type CameraView } from '../components/Avatar';
import type { Catalog, Expression } from '../content/schema';
import type { MotionClip } from '../motion/types';
import { displayFor, handFocus, hasFilled } from '../motion/display';
import { BottomSheet } from '../design/BottomSheet';
import { ChoiceCard } from '../design/ChoiceCard';
import { ChunkyButton } from '../design/ChunkyButton';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { Mascot } from '../design/Mascot';
import { ProgressBar } from '../design/ProgressBar';
import { completeStep, currentStep, gradeAnswer, isFinished, isGraded, recordAnswer, sessionProgress, skipCamera, type CameraResult, type SessionState, type Step } from './session';
import { playCue } from './sound';
import { useSequencePlayback } from './usePlayback';
import { ExpressionCaption, FilledLegend, MirrorBadge, MirrorToggle, SpeedToggle, ViewPicker } from './stage';

type Props = {
  session: SessionState; catalog: Catalog; clips: Record<string, MotionClip>; sound: boolean; mirror: boolean;
  cameraReturn: CameraResult | null;
  onSession: (next: SessionState) => void; onToggleSound: () => void; onToggleMirror: () => void; onViewed: (expressionId: string) => void;
  onCamera: (expressionId: string) => void; onCameraAcknowledged: () => void; onExit: () => void; onFinish: (final: SessionState) => void;
};
type Checked = { stepId: string; answer: string | null; correct: boolean };
const PRAISE = ['좋아요!', '정확해요!', '잘 보고 있어요!', '멋져요!'];
const LETTERS = ['A', 'B', 'C', 'D'];
const VIEWS: CameraView[] = ['front', 'first', 'hands'];

function prompt(step: Step, entry: Expression) {
  switch (step.kind) {
    case 'intro': return { title: entry.displayName, hint: entry.meaning };
    case 'pick-meaning': return { title: '이 수어는 무슨 뜻일까요?', hint: '시범을 보고 알맞은 한국어 대응 표현을 고르세요.' };
    case 'pick-sign': return { title: `‘${entry.displayName}’ 수어를 고르세요`, hint: '보기를 누르면 시범이 재생돼요.' };
    case 'same-different': return { title: '두 시범이 같은 수어일까요?', hint: '손 모양과 움직임을 비교해 보세요.' };
    case 'camera': return { title: '시범을 보고 따라 해 보세요', hint: `‘${entry.displayName}’ · 녹화한 뒤 움직임 차이를 보여 줘요. 정답 판정은 하지 않아요.` };
  }
}
function answerOptions(step: Step, session: SessionState): string[] {
  if (step.kind === 'same-different') return ['same', 'different'];
  if (step.kind === 'pick-meaning' || step.kind === 'pick-sign') return session.order[step.id] ?? step.options;
  return [];
}

export function LessonPlayer({ session, catalog, clips, sound, mirror, cameraReturn, onSession, onToggleSound, onToggleMirror, onViewed, onCamera, onCameraAcknowledged, onExit, onFinish }: Props) {
  const step = currentStep(session);
  const entries = useMemo(() => new Map(catalog.expressions.map(e => [e.id, e])), [catalog]);
  const [selected, setSelected] = useState<string | null>(null), [checked, setChecked] = useState<Checked | null>(null);
  const [demo, setDemo] = useState<string | null>(null), [speed, setSpeed] = useState(1), [view, setView] = useState<CameraView>('front');
  const [leaving, setLeaving] = useState(false), [praise, setPraise] = useState(PRAISE[0]);
  const heading = useRef<HTMLHeadingElement>(null), sheetAction = useRef<HTMLButtonElement>(null), finished = useRef(false);
  const progress = sessionProgress(session);
  const target = step ? entries.get(step.target) : undefined;
  const options = step ? answerOptions(step, session) : [];
  const camera = step?.kind === 'camera' && cameraReturn?.stepId === step.id ? cameraReturn : null;
  const sheetOpen = !!checked || !!camera;
  // Changes after every answer, even when a missed question is the only one left.
  const turn = session.completed.length + session.mistakes + Number(session.cameraSkipped);

  // One avatar canvas for the whole lesson; each step only changes which clips it plays.
  const stageIds = useMemo(() => {
    if (!step) return [];
    if (demo) return [demo];
    if (step.kind === 'same-different') return [step.target, step.other];
    if (step.kind === 'pick-sign') return selected ? [selected] : [];
    return [step.target];
  }, [step, demo, selected]);
  // Learner display: torso held still, missing handshapes filled and marked. Stored clips are unchanged.
  const stageClips = useMemo(() => stageIds.map(id => clips[id]).filter(Boolean).map(clip => displayFor(clip, 'learner')), [stageIds, clips]);
  const focus = useMemo(() => handFocus(stageClips), [stageClips]);
  const loop = step?.kind === 'intro' || step?.kind === 'pick-meaning' || step?.kind === 'camera';
  const player = useSequencePlayback(stageClips, { speed, loop: loop && !demo });

  useEffect(() => {
    setSelected(null); setChecked(null); setDemo(null);
    if (step && step.kind !== 'pick-sign') player.play(0);
    heading.current?.focus({ preventScroll: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id, turn]);
  useEffect(() => { if (sheetOpen) sheetAction.current?.focus({ preventScroll: true }); }, [sheetOpen]);
  useEffect(() => {
    if (!isFinished(session) || finished.current) return;
    finished.current = true; onFinish(session);
  }, [session, onFinish]);

  function choose(answer: string) {
    if (!step || checked) return;
    setSelected(answer); setDemo(null);
    if (step.kind === 'pick-sign') player.play(0);
  }
  function check(answer: string | null) {
    if (!step || !isGraded(step) || checked) return;
    const correct = answer !== null && gradeAnswer(step, answer);
    setChecked({ stepId: step.id, answer, correct }); setPraise(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
    playCue(correct ? 'correct' : 'wrong', sound);
  }
  function proceed() {
    if (!step) return;
    if (camera) { onSession(completeStep(session, step.id, { evidence: camera.evidence, feedback: camera.feedback })); onCameraAcknowledged(); return; }
    if (checked) { onSession(recordAnswer(session, checked.stepId, checked.correct)); return; }
    if (step.kind === 'intro') { onViewed(step.target); onSession(completeStep(session, step.id)); }
  }
  function replayAnswer() {
    if (!step) return;
    if (step.kind === 'pick-sign') setDemo(step.target);
    player.play(0);
  }

  // Layout effects run in the same task as the DOM update, so keys work the moment a step is shown.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useLayoutEffect(() => {
    onKey.current = event => {
      if (leaving || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !step) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      const onChoice = !!element?.closest('[data-choice]');
      const onControl = !!element?.closest('button, a, input, select, textarea, summary') && !onChoice;
      if (event.key === 'Escape') { event.preventDefault(); setLeaving(true); return; }
      if (/^[1-4]$/.test(event.key) && isGraded(step) && !sheetOpen) {
        const option = options[Number(event.key) - 1];
        if (option) { event.preventDefault(); choose(option); }
        return;
      }
      if (event.key !== 'Enter' || onControl) return;
      event.preventDefault();
      if (sheetOpen || step.kind === 'intro') proceed();
      else if (isGraded(step) && selected) check(selected);
    };
  });
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (!step || !target) return <div className="sl-root lp" />;
  const text = prompt(step, target);
  const sheetTone = camera ? 'neutral' : checked?.correct ? 'correct' : 'wrong';
  const answerText = step.kind === 'same-different' ? (step.same ? '같은 수어예요' : '다른 수어예요') : target.displayName;
  const tone = (option: string) => !checked ? undefined : (step.kind === 'same-different' ? (option === 'same') === step.same : option === step.target) ? 'correct' : option === checked.answer ? 'wrong' : undefined;
  const label = session.plan.kind === 'review' ? '복습 진행도' : '레슨 진행도';
  // Descriptions would give graded answers away, so they appear only once the answer is checked.
  const explained = step.kind === 'same-different'
    ? (step.same ? [{ entry: target, label: '시범 1·2' }] : [{ entry: target, label: '시범 1' }, { entry: entries.get(step.other), label: '시범 2' }].filter((item): item is { entry: Expression; label: string } => !!item.entry))
    : [{ entry: target }];

  return <div className={`sl-root lp lp-${step.kind}${sheetOpen ? ' has-sheet' : ''}`} lang="ko" data-step-kind={step.kind}>
    <header className="lp-top">
      <button type="button" className="lp-icon" aria-label="레슨 나가기" onClick={() => setLeaving(true)}><X size={28} strokeWidth={3} aria-hidden="true" /></button>
      <ProgressBar value={progress.done} max={progress.total} label={label} valueText={`${progress.total}단계 중 ${progress.done}단계 완료`} />
      <button type="button" className="lp-icon" aria-label="효과음" aria-pressed={sound} onClick={onToggleSound}>{sound ? <Volume2 size={24} strokeWidth={2.5} aria-hidden="true" /> : <VolumeX size={24} strokeWidth={2.5} aria-hidden="true" />}</button>
    </header>
    <main className="lp-body">
      <div className="lp-prompt">
        {step.kind === 'intro' && <span className="lp-badge">새 표현</span>}
        {step.kind === 'camera' && <span className="lp-badge is-sky">따라 하기</span>}
        <h1 ref={heading} tabIndex={-1}>{text.title}</h1>
        <p>{text.hint}</p>
      </div>
      <section className="lp-stage-card" aria-label="시범">
        <div className="lp-stage">
          <Avatar pose={player.pose} skeleton={false} markers={false} view={view} focus={focus} mirror={mirror} theme="light" />
          <MirrorBadge mirror={mirror} view={view} />
          {step.kind === 'pick-sign' && !stageClips.length && <p className="lp-stage-hint">보기를 누르면 여기에서 시범이 재생돼요</p>}
          {step.kind === 'same-different' && !demo && <span className="lp-stage-tag" aria-live="polite">시범 {player.index + 1}</span>}
        </div>
        <div className="lp-controls">
          <button type="button" className="sl-toggle" onClick={() => { setDemo(null); player.play(0); }} disabled={!stageClips.length}>
            {player.playing ? <RotateCcw size={20} strokeWidth={2.5} aria-hidden="true" /> : <Play size={20} strokeWidth={2.5} aria-hidden="true" />}<span>다시 보기</span></button>
          <SpeedToggle speed={speed} onChange={setSpeed} />
          <MirrorToggle mirror={mirror} onToggle={onToggleMirror} />
          <ViewPicker views={VIEWS} value={view} onChange={setView} />
        </div>
        {stageClips.some(hasFilled) && <FilledLegend />}
        {(step.kind === 'intro' || step.kind === 'camera') && <ExpressionCaption items={[{ entry: target }]} />}
        {step.kind === 'same-different' && <div className="lp-pair" role="group" aria-label="시범 따로 보기">
          {['시범 1', '시범 2'].map((name, i) => <button type="button" key={name} className="sl-toggle" onClick={() => { setDemo([step.target, step.other][i]); player.play(0); }}><Play size={18} strokeWidth={2.5} aria-hidden="true" /><span>{name}</span></button>)}
        </div>}
      </section>
      {isGraded(step) && <div className={`lp-choices${step.kind === 'pick-meaning' && options.length > 2 ? ' is-grid' : ''}${step.kind === 'pick-sign' ? ' is-letters' : ''}`} role="group" aria-label="보기">
        {options.map((option, i) => {
          const body = step.kind === 'same-different'
            ? <span className="lp-choice-icon">{option === 'same' ? <Equal size={22} strokeWidth={3} aria-hidden="true" /> : <EqualNot size={22} strokeWidth={3} aria-hidden="true" />}{option === 'same' ? '같아요' : '달라요'}</span>
            : step.kind === 'pick-sign' ? <span className="lp-choice-icon"><Play size={20} strokeWidth={2.75} aria-hidden="true" />{LETTERS[i]}</span>
              : entries.get(option)?.displayName;
          return <ChoiceCard key={option} index={i} selected={selected === option} tone={tone(option)} disabled={sheetOpen}
            label={step.kind === 'pick-sign' ? `보기 ${LETTERS[i]}` : undefined} onSelect={() => choose(option)}>{body}</ChoiceCard>;
        })}
      </div>}
      {step.kind === 'camera' && <p className="lp-camera-note"><Info size={20} strokeWidth={2.5} aria-hidden="true" />카메라 영상은 이 기기 안에서만 처리하고 저장하지 않아요.</p>}
    </main>
    {!sheetOpen && <footer className="lp-footer"><div className="lp-footer-inner">
      {step.kind === 'intro' && <ChunkyButton block onClick={proceed}>계속</ChunkyButton>}
      {isGraded(step) && <>
        <ChunkyButton variant="secondary" onClick={() => check(null)}>건너뛰기</ChunkyButton>
        <ChunkyButton disabled={!selected} onClick={() => selected && check(selected)}>확인</ChunkyButton>
      </>}
      {step.kind === 'camera' && <>
        <ChunkyButton variant="secondary" onClick={() => onSession(skipCamera(session))}>지금은 카메라를 쓸 수 없어요</ChunkyButton>
        <ChunkyButton onClick={() => { player.pause(); onCamera(step.target); }}><Camera size={22} strokeWidth={2.5} aria-hidden="true" />카메라로 따라 하기</ChunkyButton>
      </>}
    </div></footer>}
    <BottomSheet open={sheetOpen} tone={sheetTone}
      icon={camera ? <Info size={28} strokeWidth={3} /> : checked?.correct ? <Check size={30} strokeWidth={3.5} /> : <X size={30} strokeWidth={3.5} />}
      title={camera ? '연습 기록을 남겼어요' : checked?.correct ? praise : checked?.answer === null ? '정답은 이거예요' : '아쉬워요'}
      aside={checked && !checked.correct ? <Mascot mood="encourage" size={64} /> : undefined}
      action={<ChunkyButton ref={sheetAction} block variant={camera ? 'sky' : checked?.correct ? 'primary' : 'danger'} onClick={proceed}>{checked && !checked.correct ? '확인했어요' : '계속'}</ChunkyButton>}>
      {camera ? <>
        {camera.feedback.length ? <ul>{camera.feedback.slice(0, 3).map((note, i) => <li key={i}>{note}</li>)}</ul> : <p>표시할 만큼 큰 움직임 차이는 관찰되지 않았어요.</p>}
        {camera.evidence === 'limited' && <p>일부 구간은 손 추적 정보가 부족했어요.</p>}
        <p className="sl-sheet-note">동작 비교는 정답 판정이 아니에요.</p>
      </> : checked && !checked.correct ? <>
        <p>정답: {answerText}</p>
        <ExpressionCaption items={explained} />
        <button type="button" className="sl-sheet-link" onClick={replayAnswer}><RotateCcw size={16} strokeWidth={2.75} aria-hidden="true" />시범 다시 보기</button>
      </> : checked ? <ExpressionCaption items={explained} /> : null}
    </BottomSheet>
    <ConfirmDialog open={leaving} title="레슨을 나갈까요?" body="지금 나가면 이번 레슨 진행이 저장되지 않아요."
      stayLabel="계속 학습하기" leaveLabel="나가기" onStay={() => setLeaving(false)} onLeave={onExit} />
  </div>;
}
