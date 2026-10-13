import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ExternalLink, Pause, Play, Repeat, RotateCcw, Turtle } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { samplePose } from '../motion/player';
import type { MotionClip } from '../motion/types';
import type { Expression } from '../content/schema';
import { ChunkyButton } from '../design/ChunkyButton';
import { Mascot } from '../design/Mascot';
import type { ContentSource } from '../learn/source';
import { progressKey, type ProgressRecord } from './catalog';

const VIEWS = [['front', '정면'], ['side', '측면'], ['rear', '뒤에서']] as const;

/** Expression card: reviewed 3D demonstration, original video, movement notes, sources and practice history. */
export function LessonDetail({ entry, source, progress, backLabel, onBack, onViewed, onPractice }: {
  entry: Expression; source: ContentSource; progress: ProgressRecord; backLabel: string;
  onBack: () => void; onViewed: () => void; onPractice: (clip: MotionClip) => void;
}) {
  const [clip, setClip] = useState<MotionClip | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [videoUrl, setVideoUrl] = useState(''), [videoError, setVideoError] = useState('');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [repeat, setRepeat] = useState(true), [preset, setPreset] = useState('front');
  const video = useRef<HTMLVideoElement>(null), clock = useRef(0);
  const current = progress[progressKey(entry)] ?? { viewed: false, attempts: 0 };
  useEffect(() => {
    const controller = new AbortController(); setClip(null); setError('');
    source.loadMotion(entry, controller.signal).then(value => { if (!controller.signal.aborted) setClip(value); })
      .catch(() => { if (!controller.signal.aborted) setError('시범 자료를 불러오거나 검증하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); });
    return () => controller.abort();
  }, [entry, source, retry]);
  useEffect(() => {
    const controller = new AbortController(); let url = ''; setVideoUrl(''); setVideoError('');
    if (clip && entry.assets.video) source.loadVideo(entry, controller.signal).then(blob => {
      if (controller.signal.aborted || !blob) return;
      url = URL.createObjectURL(blob); setVideoUrl(url);
    }).catch(() => { if (!controller.signal.aborted) setVideoError('원본 영상을 불러오지 못했어요. 3D 시범은 계속 볼 수 있어요.'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [entry, source, retry, clip]);
  const duration = (clip?.frames.at(-1)?.timestamp ?? 0) / 1000;
  const pose = useMemo(() => clip ? samplePose(clip, time) : null, [clip, time]);
  function seek(value: number) {
    clock.current = Math.max(0, Math.min(duration, value)); setTime(clock.current);
    if (video.current?.readyState) video.current.currentTime = clock.current + (clip?.source.timeOffset ?? 0);
  }
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, videoUrl]);
  useEffect(() => {
    if (!playing || !clip) return;
    let previous = performance.now();
    const handle = window.setInterval(() => {
      const now = performance.now();
      const next = video.current?.readyState ? Math.max(0, video.current.currentTime - (clip.source.timeOffset ?? 0)) : clock.current + (now - previous) / 1000 * speed;
      previous = now;
      if (next >= duration) {
        if (repeat) { seek(0); if (video.current) void video.current.play().catch(() => { setVideoError('영상 재생이 중단되었어요.'); setVideoUrl(''); }); }
        else { seek(duration); setPlaying(false); video.current?.pause(); }
      } else { clock.current = next; setTime(next); }
    }, 33);
    return () => clearInterval(handle);
  }, [playing, clip, duration, speed, repeat]);
  async function toggle() {
    if (playing) { setPlaying(false); video.current?.pause(); return; }
    if (time >= duration) seek(0);
    try { if (video.current) await video.current.play(); setPlaying(true); }
    catch { setVideoError('원본 영상 재생이 중단되었어요. 3D 시범은 계속 볼 수 있어요.'); setVideoUrl(''); setPlaying(true); }
  }
  const linguistic = entry.reviews.linguistic.evidence, reconstruction = entry.reviews.reconstruction.evidence;
  return <article className="sl-root ec" lang="ko" aria-labelledby="ec-title">
    <ChunkyButton variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={20} strokeWidth={2.5} aria-hidden="true" />{backLabel}</ChunkyButton>
    <header className="ec-head">
      <p className="ec-kicker">{entry.category} · 한국어 대응 표현</p>
      <h1 id="ec-title">{entry.displayName}</h1>
      <p className="ec-meaning">{entry.meaning}</p>
    </header>
    {error ? <div role="alert" className="sl-alert"><Mascot mood="oops" size={72} /><div><p>{error}</p>
      <ChunkyButton variant="secondary" size="sm" onClick={() => setRetry(value => value + 1)}><RotateCcw size={18} strokeWidth={2.5} aria-hidden="true" />다시 시도</ChunkyButton></div></div>
      : !clip ? <div role="status" className="sl-loading"><Mascot mood="thinking" size={72} /><p>시범 자료를 확인하는 중이에요…</p></div> : <>
      <section className="ec-stage-card" aria-label="3D 동작 시범">
        <div className="ec-stage"><Avatar pose={pose} skeleton={false} markers={false} preset={preset} theme="light" /></div>
        <div className="ec-controls">
          <ChunkyButton variant="sky" size="sm" onClick={() => void toggle()}>{playing ? <Pause size={20} strokeWidth={2.75} aria-hidden="true" /> : <Play size={20} strokeWidth={2.75} aria-hidden="true" />}{playing ? '일시정지' : '시범 재생'}</ChunkyButton>
          <button type="button" className="sl-toggle" aria-pressed={speed === .5} onClick={() => setSpeed(value => value === .5 ? 1 : .5)}><Turtle size={22} strokeWidth={2.5} aria-hidden="true" /><span>0.5배속</span></button>
          <button type="button" className="sl-toggle" aria-pressed={repeat} onClick={() => setRepeat(value => !value)}><Repeat size={20} strokeWidth={2.5} aria-hidden="true" /><span>반복</span></button>
        </div>
        <input className="ec-scrub" aria-label="시범 재생 위치" type="range" min={0} max={duration || 1} step="0.01" value={time} onChange={event => seek(Number(event.target.value))} />
        <div className="sl-segmented" role="group" aria-label="시범 카메라 시점">
          {VIEWS.map(([value, label]) => <button type="button" key={value} aria-pressed={preset === value} onClick={() => setPreset(value)}>{label}</button>)}
        </div>
        <p className="ec-hint">아바타를 드래그하면 시점을 돌릴 수 있어요. <strong>뒤에서</strong>는 내 손과 같은 방향으로 보여요.</p>
      </section>
      <section className="ec-section" aria-labelledby="ec-video"><h2 id="ec-video">원본 수어 영상</h2>
        {videoUrl ? <video ref={video} src={videoUrl} muted playsInline preload="metadata" aria-label="원본 수어 영상" onLoadedMetadata={() => { if (video.current) { video.current.currentTime = clock.current + (clip.source.timeOffset ?? 0); video.current.playbackRate = speed; if (playing) void video.current.play().catch(() => setVideoUrl('')); } }} onError={() => { setVideoError('원본 영상을 재생하지 못했어요. 3D 시범은 계속 볼 수 있어요.'); setVideoUrl(''); }} />
          : <p className="ec-muted">{videoError || '이 사이트에서 재생할 수 있는 원본 영상이 없어요. 아래 출처 페이지에서 볼 수 있어요.'}</p>}
      </section>
      {!!entry.movementNotes.length && <section className="ec-section" aria-labelledby="ec-notes"><h2 id="ec-notes">움직임 살펴보기</h2><ul className="ec-notes">{entry.movementNotes.map(note => <li key={note}>{note}</li>)}</ul></section>}
      <ul className="ec-checklist" aria-label="이 표현의 학습 기록">
        <li className={current.viewed ? 'is-done' : ''}><Check size={18} strokeWidth={3} aria-hidden="true" />{current.viewed ? '시범 관찰 완료' : '시범 관찰 전'}</li>
        <li className={current.attempts ? 'is-done' : ''}><Check size={18} strokeWidth={3} aria-hidden="true" />따라 하기 {current.attempts}회</li>
      </ul>
      <div className="ec-actions">
        <ChunkyButton variant="secondary" onClick={onViewed}>{current.viewed ? '시범 관찰 기록됨' : '시범 확인 완료'}</ChunkyButton>
        <ChunkyButton onClick={() => { video.current?.pause(); setPlaying(false); onPractice(clip); }}><Camera size={22} strokeWidth={2.5} aria-hidden="true" />카메라로 따라 하기</ChunkyButton>
      </div>
    </>}
    <section className="ec-section" aria-labelledby="ec-history"><h2 id="ec-history">연습 기록 · {current.attempts}회</h2>
      {current.history?.length ? <ul className="ec-history">{current.history.slice().reverse().map((item, i) => <li key={i}>
        <strong>{new Date(item.at).toLocaleString('ko-KR')}</strong> · {item.evidence === 'limited' ? '일부 추적 정보 부족' : '관찰한 움직임 비교'}
        {item.feedback.map((note, j) => <p key={j}>{note}</p>)}</li>)}</ul>
        : <p className="ec-muted">카메라로 따라 한 뒤 결과를 확인하면 기록이 남아요.</p>}
    </section>
    <details className="ec-source"><summary>출처와 이용 조건</summary>
      <p><a href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title} <ExternalLink size={15} strokeWidth={2.5} aria-hidden="true" /></a></p>
      <p>{entry.source.attribution}</p><p>{entry.license.type} · {entry.license.notes}</p><p>표현 변이: {entry.variant.description}</p>
      <p>한국수어 검수: {linguistic?.reviewer} · {linguistic?.date}</p><p>3D 동작 검수: {reconstruction?.reviewer} · {reconstruction?.date}</p>
    </details>
    <p className="ec-disclaimer">동작 피드백은 관찰된 움직임 차이를 설명해요. 한국수어의 의미·문법·표정이 맞았다는 판정은 아니에요. 영상과 관절 데이터는 학습 기록에 저장하지 않아요.</p>
  </article>;
}
