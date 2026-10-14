import { useCallback, useEffect, useMemo, useState } from 'react';
import { displayDuration as duration, sampleDisplay, type DisplayClip } from '../motion/display';

const REST_MS = 600;

/**
 * Plays one or more display clips in order on a single avatar (e.g. "시범 1" then "시범 2").
 * Looping pauses briefly between repetitions so the start and end of a sign stay visible.
 */
export function useSequencePlayback(clips: readonly DisplayClip[], { speed, loop }: { speed: number; loop: boolean }) {
  const [state, setState] = useState({ index: 0, time: 0, playing: false, rest: 0 });
  const play = useCallback((index = 0) => setState({ index, time: 0, playing: true, rest: 0 }), []);
  const pause = useCallback(() => setState(s => ({ ...s, playing: false })), []);
  const toggle = useCallback(() => setState(s => {
    if (s.playing) return { ...s, playing: false };
    const clip = clips[s.index];
    return clip && s.time >= duration(clip) ? { index: 0, time: 0, playing: true, rest: 0 } : { ...s, playing: true };
  }), [clips]);
  useEffect(() => {
    if (!state.playing || !clips.length) return;
    let previous = performance.now();
    const handle = window.setInterval(() => {
      const now = performance.now(), elapsed = now - previous; previous = now;
      setState(s => {
        const clip = clips[s.index];
        if (!clip) return { ...s, playing: false };
        if (s.time < duration(clip)) return { ...s, time: Math.min(duration(clip), s.time + elapsed / 1000 * speed) };
        if (s.rest + elapsed < REST_MS) return { ...s, rest: s.rest + elapsed };
        if (s.index + 1 < clips.length) return { index: s.index + 1, time: 0, playing: true, rest: 0 };
        return loop ? { index: 0, time: 0, playing: true, rest: 0 } : { ...s, playing: false, rest: 0 };
      });
    }, 33);
    return () => window.clearInterval(handle);
  }, [state.playing, clips, speed, loop]);
  const clip = clips[Math.min(state.index, clips.length - 1)];
  const pose = useMemo(() => clip ? sampleDisplay(clip, state.time) : null, [clip, state.time]);
  return { index: state.index, time: state.time, playing: state.playing, pose, play, pause, toggle };
}
