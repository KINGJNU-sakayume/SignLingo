/**
 * Short synthesized cues (no audio files). Sound is never the only signal: every cue
 * accompanies a visible sheet, icon and text. A short vibration is added where supported.
 */
export type Cue = 'correct' | 'wrong' | 'complete';
const NOTES: Record<Cue, [number, number][]> = {
  correct: [[784, 0], [1047, .09]],
  wrong: [[330, 0], [262, .12]],
  complete: [[523, 0], [659, .1], [784, .2], [1047, .3]],
};
const VIBRATION: Record<Cue, number | number[]> = { correct: 25, wrong: [40, 50, 40], complete: [30, 40, 60] };
let context: AudioContext | null = null;

export function playCue(cue: Cue, enabled: boolean) {
  if (!enabled) return;
  try { navigator.vibrate?.(VIBRATION[cue]); } catch { /* Vibration is optional. */ }
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + .01;
    for (const [frequency, offset] of NOTES[cue]) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = cue === 'wrong' ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(.08, start + offset + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset); oscillator.stop(start + offset + .18);
    }
  } catch { /* Audio is optional; feedback stays visible. */ }
}
