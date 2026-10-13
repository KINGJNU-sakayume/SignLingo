import { Dumbbell, House, ScanFace, Video, Volume2, VolumeX } from 'lucide-react';
import { Mascot } from '../design/Mascot';

export type NavMode = 'learn' | 'review' | 'practice' | 'lab';
const ITEMS: { mode: NavMode; label: string; Icon: typeof House }[] = [
  { mode: 'learn', label: '학습하기', Icon: House },
  { mode: 'review', label: '복습', Icon: Dumbbell },
  { mode: 'practice', label: '수어 연습', Icon: Video },
  { mode: 'lab', label: '동작 복원', Icon: ScanFace },
];
function SoundToggle({ sound, onToggle }: { sound: boolean; onToggle: () => void }) {
  return <button type="button" className="sl-sound" aria-label="효과음" aria-pressed={sound} onClick={onToggle}>
    {sound ? <Volume2 size={22} strokeWidth={2.5} aria-hidden="true" /> : <VolumeX size={22} strokeWidth={2.5} aria-hidden="true" />}
    <span className="sl-sound-label" aria-hidden="true">{sound ? '소리 켜짐' : '소리 꺼짐'}</span>
  </button>;
}

/** Bottom tab bar on phones, icon rail on tablets, labelled sidebar on desktop. One element, restyled by CSS. */
export function AppNav({ active, dueCount, sound, onNavigate, onToggleSound }: { active: NavMode | null; dueCount: number; sound: boolean; onNavigate: (mode: NavMode) => void; onToggleSound: () => void }) {
  return <nav className="sl-root sl-nav" aria-label="주요 메뉴">
    <p className="sl-brand"><Mascot size={40} /><span className="sl-brand-name">SignLingo</span></p>
    <ul className="sl-nav-items">{ITEMS.map(({ mode, label, Icon }) => <li key={mode}>
      <button type="button" className="sl-nav-item" aria-current={active === mode ? 'page' : undefined} onClick={() => onNavigate(mode)}>
        <span className="sl-nav-icon"><Icon size={26} strokeWidth={2.5} aria-hidden="true" />{mode === 'review' && dueCount > 0 && <span className="sl-nav-dot" aria-hidden="true" />}</span>
        <span className="sl-nav-label">{label}</span>
      </button>
    </li>)}</ul>
    <div className="sl-nav-foot"><SoundToggle sound={sound} onToggle={onToggleSound} /></div>
  </nav>;
}

export function TopBar({ title, sound, onToggleSound }: { title: string; sound: boolean; onToggleSound: () => void }) {
  return <header className="sl-root sl-topbar">
    <p className="sl-brand"><Mascot size={34} /><span className="sl-visually-hidden">SignLingo</span></p>
    <p className="sl-topbar-title">{title}</p>
    <SoundToggle sound={sound} onToggle={onToggleSound} />
  </header>;
}
