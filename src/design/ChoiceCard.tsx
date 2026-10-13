import type { ReactNode } from 'react';

type Props = {
  index: number; selected: boolean; onSelect: () => void; children: ReactNode;
  tone?: 'correct' | 'wrong'; disabled?: boolean; label?: string;
};
/** Answer option. The number badge matches the 1–4 keyboard shortcut. */
export function ChoiceCard({ index, selected, onSelect, children, tone, disabled, label }: Props) {
  return <button type="button" className={`sl-choice${selected ? ' is-selected' : ''}${tone ? ` is-${tone}` : ''}`}
    aria-pressed={selected} aria-label={label} disabled={disabled} data-choice={index} onClick={onSelect}>
    <span className="sl-choice-key" aria-hidden="true">{index + 1}</span>
    <span className="sl-choice-body">{children}</span>
  </button>;
}
