import { useEffect, useId, useRef } from 'react';
import { ChunkyButton } from './ChunkyButton';

type Props = { open: boolean; title: string; body: string; stayLabel: string; leaveLabel: string; onStay: () => void; onLeave: () => void };

/** Modal confirmation with a focus trap. Escape keeps the learner where they are. */
export function ConfirmDialog({ open, title, body, stayLabel, leaveLabel, onStay, onLeave }: Props) {
  const box = useRef<HTMLDivElement>(null), stay = useRef<HTMLButtonElement>(null), id = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    stay.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onStay(); return; }
      if (event.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!box.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, [open, onStay]);
  if (!open) return null;
  return <div className="sl-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onStay(); }}>
    <div ref={box} className="sl-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-body`}>{body}</p>
      <div className="sl-dialog-actions">
        <ChunkyButton ref={stay} variant="primary" block onClick={onStay}>{stayLabel}</ChunkyButton>
        <ChunkyButton variant="ghost" block onClick={onLeave}>{leaveLabel}</ChunkyButton>
      </div>
    </div>
  </div>;
}
