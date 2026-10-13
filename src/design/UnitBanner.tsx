import { BookOpen } from 'lucide-react';

type Props = { number: number; category: string; title: string; theme: string; soon?: boolean; onGuidebook: () => void; id?: string };

export function UnitBanner({ number, category, title, theme, soon, onGuidebook, id }: Props) {
  return <header className={`sl-unit-banner unit-${soon ? 'soon' : theme}`} id={id}>
    <div className="sl-unit-banner-text">
      <p className="sl-unit-kicker">단원 {number} · {category}</p>
      <h2>{title}</h2>
    </div>
    <button type="button" className="sl-banner-guide" onClick={onGuidebook} aria-label={`단원 ${number} 가이드북`}>
      <BookOpen size={22} strokeWidth={2.5} aria-hidden="true" /><span>가이드북</span>
    </button>
  </header>;
}
