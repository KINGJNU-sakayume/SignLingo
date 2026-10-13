/**
 * "새미" — SignLingo's sprout friend. Emotion is carried only by the brows, eyes, mouth and
 * whole-body motion: Korean Sign Language uses facial expression as a nonmanual signal, so the
 * character is a face-first friend. Its hands are plain oval nubs fixed to the body. They never
 * move, form a handshape or imitate any sign.
 */
export type MascotMood = 'idle' | 'cheer' | 'encourage' | 'thinking' | 'sleep' | 'oops';

const ink = { stroke: 'var(--ink)', strokeWidth: 3.5, strokeLinecap: 'round' as const, fill: 'none' };

function Face({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case 'cheer': return <>
      <path d="M38 47 Q45 41 52 45" {...ink} /><path d="M68 45 Q75 41 82 47" {...ink} />
      <path d="M39 63 Q45 55 51 63" {...ink} /><path d="M69 63 Q75 55 81 63" {...ink} />
      <path d="M47 73 Q60 94 73 73 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M53 82 Q60 78 67 82 Q64 88 60 88 Q56 88 53 82 Z" fill="var(--coral)" />
    </>;
    case 'encourage': return <>
      <path d="M39 52 Q45 50 52 46" {...ink} /><path d="M68 46 Q75 50 81 52" {...ink} />
      <ellipse cx="46" cy="63" rx="4.5" ry="6" fill="var(--ink)" /><ellipse cx="74" cy="63" rx="4.5" ry="6" fill="var(--ink)" />
      <circle cx="47.5" cy="60.5" r="1.6" fill="var(--canvas)" /><circle cx="75.5" cy="60.5" r="1.6" fill="var(--canvas)" />
      <path d="M53 78 Q60 83 67 78" {...ink} />
    </>;
    case 'thinking': return <>
      <path d="M39 51 L52 50" {...ink} /><path d="M68 46 Q75 41 82 45" {...ink} />
      <ellipse cx="46" cy="62" rx="5" ry="6.5" fill="var(--ink)" /><ellipse cx="74" cy="62" rx="5" ry="6.5" fill="var(--ink)" />
      <circle cx="48.5" cy="58.5" r="2" fill="var(--canvas)" /><circle cx="76.5" cy="58.5" r="2" fill="var(--canvas)" />
      <path d="M55 79 Q61 77 66 78" {...ink} />
      <g className="mascot-dots" fill="var(--ink-muted)"><circle cx="94" cy="38" r="3" /><circle cx="103" cy="28" r="4" /><circle cx="113" cy="16" r="5" /></g>
    </>;
    case 'sleep': return <>
      <path d="M39 53 Q45 51 52 53" {...ink} /><path d="M68 53 Q75 51 81 53" {...ink} />
      <path d="M40 63 Q46 67 52 63" {...ink} /><path d="M68 63 Q74 67 80 63" {...ink} />
      <ellipse cx="60" cy="79" rx="3.5" ry="3" fill="var(--ink)" />
      <g className="mascot-z" {...ink} strokeWidth={3}><path d="M90 34 H100 L90 44 H100" /><path d="M104 18 H111 L104 25 H111" /></g>
    </>;
    case 'oops': return <>
      <path d="M38 47 Q45 46 52 41" {...ink} /><path d="M68 41 Q75 46 82 47" {...ink} />
      <ellipse cx="46" cy="62" rx="5.5" ry="7" fill="var(--ink)" /><ellipse cx="74" cy="62" rx="5.5" ry="7" fill="var(--ink)" />
      <circle cx="47.5" cy="59" r="2" fill="var(--canvas)" /><circle cx="75.5" cy="59" r="2" fill="var(--canvas)" />
      <path d="M49 80 Q54.5 75 60 80 Q65.5 85 71 80" {...ink} />
      <path className="mascot-drop" d="M97 40 Q103 50 97 54 Q91 50 97 40 Z" fill="var(--sky-tint)" stroke="var(--sky)" strokeWidth="2.5" strokeLinejoin="round" />
    </>;
    default: return <>
      <path d="M39 50 Q45 46 52 49" {...ink} /><path d="M68 49 Q75 46 81 50" {...ink} />
      <ellipse cx="46" cy="62" rx="5" ry="6.5" fill="var(--ink)" /><ellipse cx="74" cy="62" rx="5" ry="6.5" fill="var(--ink)" />
      <circle cx="47.5" cy="59.5" r="1.8" fill="var(--canvas)" /><circle cx="75.5" cy="59.5" r="1.8" fill="var(--canvas)" />
      <path d="M52 76 Q60 84 68 76" {...ink} />
    </>;
  }
}

export function Mascot({ mood = 'idle', size = 120, label, className = '' }: { mood?: MascotMood; size?: number; label?: string; className?: string }) {
  return <svg className={`sl-mascot mascot-${mood} ${className}`.trim()} width={size} height={size} viewBox="0 0 120 120"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    <g className="mascot-body">
      <ellipse cx="47" cy="104" rx="9" ry="4.5" fill="var(--sun-deep)" />
      <ellipse cx="73" cy="104" rx="9" ry="4.5" fill="var(--sun-deep)" />
      <path d="M60 18 V30" stroke="var(--leaf-deep)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M60 22 C52 10 41 11 38 17 C44 25 54 26 60 22 Z" fill="var(--leaf)" stroke="var(--leaf-deep)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 20 C66 6 79 6 83 12 C77 21 67 23 60 20 Z" fill="var(--leaf)" stroke="var(--leaf-deep)" strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="19" cy="78" rx="8" ry="10" fill="var(--sun)" stroke="var(--sun-deep)" strokeWidth="3" />
      <ellipse cx="101" cy="78" rx="8" ry="10" fill="var(--sun)" stroke="var(--sun-deep)" strokeWidth="3" />
      <path d="M60 29 C87 29 101 47 101 69 C101 91 85 103 60 103 C35 103 19 91 19 69 C19 47 33 29 60 29 Z" fill="var(--sun)" stroke="var(--sun-deep)" strokeWidth="3" />
      <ellipse cx="60" cy="86" rx="23" ry="12" fill="var(--sun-tint)" opacity=".55" />
      <ellipse cx="36" cy="74" rx="7" ry="4.5" fill="var(--coral)" opacity=".3" />
      <ellipse cx="84" cy="74" rx="7" ry="4.5" fill="var(--coral)" opacity=".3" />
      <Face mood={mood} />
    </g>
  </svg>;
}
