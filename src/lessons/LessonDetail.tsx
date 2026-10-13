import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { samplePose } from '../motion/player';
import type { MotionClip } from '../motion/types';
import { fetchAsset, loadLessonMotion } from '../content/assets';
import type { Expression } from '../content/schema';
import { progressKey, type ProgressRecord } from './catalog';

export function LessonDetail({ entry, progress, onBack, onViewed, onPractice }: {
  entry: Expression; progress: ProgressRecord; onBack: () => void; onViewed: () => void; onPractice: (clip: MotionClip) => void;
}) {
  const [clip, setClip] = useState<MotionClip | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [videoUrl, setVideoUrl] = useState(''), [videoError, setVideoError] = useState('');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [repeat, setRepeat] = useState(true), [preset, setPreset] = useState('front');
  const video = useRef<HTMLVideoElement>(null), clock = useRef(0);
  const current = progress[progressKey(entry)] ?? { viewed: false, attempts: 0 };
  useEffect(() => {
    const controller = new AbortController(); setClip(null); setError('');
    loadLessonMotion(entry, controller.signal).then(value => { if (!controller.signal.aborted) setClip(value); })
      .catch(() => { if (!controller.signal.aborted) setError('시범 자료를 불러오거나 검증하지 못했습니다. 연결을 확인하고 다시 시도하세요.'); });
    return () => controller.abort();
  }, [entry, retry]);
  useEffect(() => {
    const controller = new AbortController(); let url = ''; setVideoUrl(''); setVideoError('');
    if (clip && entry.assets.video) fetchAsset(entry.assets.video, controller.signal).then(bytes => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: entry.assets.video!.mediaType })); setVideoUrl(url);
    }).catch(() => { if (!controller.signal.aborted) setVideoError('원본 영상을 불러오지 못했습니다. 3D 시범은 계속 볼 수 있습니다.'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [entry, retry, clip]);
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
        if (repeat) { seek(0); if (video.current) void video.current.play().catch(() => { setVideoError('영상 재생이 중단되었습니다.'); setVideoUrl(''); }); }
        else { seek(duration); setPlaying(false); video.current?.pause(); }
      } else { clock.current = next; setTime(next); }
    }, 33);
    return () => clearInterval(handle);
  }, [playing, clip, duration, speed, repeat]);
  async function toggle() {
    if (playing) { setPlaying(false); video.current?.pause(); return; }
    if (time >= duration) seek(0);
    try { if (video.current) await video.current.play(); setPlaying(true); }
    catch { setVideoError('원본 영상 재생이 중단되었습니다. 3D 시범은 계속 볼 수 있습니다.'); setVideoUrl(''); setPlaying(true); }
  }
  const complete = Number(current.viewed) + Number(current.attempts > 0);
  return <section className="lesson-workspace" aria-labelledby="lesson-title">
    <button className="button secondary" onClick={onBack}>← 학습 과정으로</button><p className="lesson-meta">{entry.category} · 초급</p>
    <h2 id="lesson-title">{entry.displayName}</h2><p className="lesson-lead">{entry.meaning}</p><p>{entry.description}</p>
    <div className="lesson-progressbar" role="progressbar" aria-label="레슨 진행도" aria-valuemin={0} aria-valuemax={2} aria-valuenow={complete}><span style={{ width: `${complete * 50}%` }} /></div>
    <p className="lesson-note">관찰 · 연습 {complete}/2단계</p>
    {error ? <p role="alert" className="lesson-error">{error} <button onClick={() => setRetry(value => value + 1)}>다시 시도</button></p> : !clip ? <p role="status">시범 자료를 확인하는 중입니다…</p> : <>
      <div className="lesson-reference"><section><h3>3D 동작 시범</h3><div className="practice-avatar"><Avatar pose={pose} skeleton={false} markers={false} preset={preset} /></div><div className="lesson-actions" aria-label="시범 카메라 시점">{[['front', '정면'], ['side', '측면'], ['rear', '후면']].map(([value, label]) => <button className="button secondary" key={value} aria-pressed={preset === value} onClick={() => setPreset(value)}>{label}</button>)}</div><p className="lesson-note">아바타를 드래그하면 시점을 돌릴 수 있습니다.</p></section>
        <section><h3>원본 수어 영상</h3>{videoUrl ? <video ref={video} src={videoUrl} muted playsInline preload="metadata" aria-label="원본 수어 영상" onLoadedMetadata={() => { if (video.current) { video.current.currentTime = clock.current + (clip.source.timeOffset ?? 0); video.current.playbackRate = speed; if (playing) void video.current.play().catch(() => setVideoUrl('')); } }} onError={() => { setVideoError('원본 영상을 재생하지 못했습니다. 3D 시범은 계속 볼 수 있습니다.'); setVideoUrl(''); }} /> : <p className="lesson-empty">{videoError || '사이트에 재생 가능한 원본 영상이 없습니다. 아래 출처 페이지를 방문해 주세요.'}</p>}</section></div>
      <div className="lesson-slider"><button className="button secondary" onClick={() => void toggle()}>{playing ? '일시정지' : '시범 재생'}</button><input aria-label="시범 재생 위치" type="range" min={0} max={duration || 1} step="0.01" value={time} onChange={event => seek(Number(event.target.value))} /><span>{time.toFixed(1)} / {duration.toFixed(1)}초</span></div>
      <div className="lesson-actions"><label>재생 속도 <select aria-label="시범 재생 속도" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1].map(value => <option key={value} value={value}>{value}배속</option>)}</select></label><label><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} /> 반복 재생</label></div>
      <h3>손 모양과 움직임 살펴보기</h3><ul>{entry.movementNotes.map(note => <li key={note}>{note}</li>)}</ul>
      <div className="lesson-actions"><button className="button secondary" onClick={onViewed}>{current.viewed ? '시범 관찰 기록됨' : '시범 확인 완료'}</button><button className="button primary" onClick={() => { video.current?.pause(); setPlaying(false); onPractice(clip); }}>카메라로 따라 하기 →</button></div>
    </>}
    <section aria-label="연습 기록"><h3>연습 기록 · {current.attempts}회</h3>{current.history?.length ? <ul>{current.history.slice().reverse().map((item, i) => <li key={i}>{new Date(item.at).toLocaleString('ko-KR')} · {item.evidence === 'limited' ? '일부 추적 정보 부족' : '관찰 가능한 동작 비교'}{item.feedback.map((note, j) => <p className="lesson-note" key={j}>{note}</p>)}</li>)}</ul> : <p className="lesson-note">연습 후 결과를 검토하면 기록이 남습니다.</p>}</section>
    <details className="lesson-source"><summary>출처와 이용 조건</summary><p><a href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title} ↗</a></p><p>{entry.source.attribution}</p><p>{entry.license.type} · {entry.license.notes}</p><p>표현 변이: {entry.variant.description}</p><p>한국수어 검수: {entry.reviews.linguistic.evidence?.reviewer} · {entry.reviews.linguistic.evidence?.date}</p><p>3D 동작 검수: {entry.reviews.reconstruction.evidence?.reviewer} · {entry.reviews.reconstruction.evidence?.date}</p></details>
    <p className="lesson-footer-note">동작 피드백은 관찰 가능한 차이를 설명합니다. 한국수어의 의미·문법·표정이 정확하다는 판정은 아닙니다. 영상과 관절 데이터는 학습 기록에 저장하지 않습니다.</p>
  </section>;
}
