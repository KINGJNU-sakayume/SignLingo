import type { ReactNode } from 'react';

export type SheetTone = 'correct' | 'wrong' | 'neutral';
type Props = { open: boolean; tone: SheetTone; icon: ReactNode; title: string; children?: ReactNode; action: ReactNode; aside?: ReactNode };

/** Feedback sheet. The polite live region stays mounted so its content is announced when it opens. */
export function BottomSheet({ open, tone, icon, title, children, action, aside }: Props) {
  return <div className="sl-sheet-live" aria-live="polite">
    {open && <section className={`sl-sheet sl-sheet-${tone}`} aria-label={title}>
      <div className="sl-sheet-inner">
        <div className="sl-sheet-message">
          <span className="sl-sheet-icon" aria-hidden="true">{icon}</span>
          <div className="sl-sheet-text"><h2>{title}</h2>{children}</div>
          {aside && <span className="sl-sheet-aside" aria-hidden="true">{aside}</span>}
        </div>
        <div className="sl-sheet-action">{action}</div>
      </div>
    </section>}
  </div>;
}
