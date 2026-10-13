import { forwardRef } from 'react';
import { Check, Dumbbell, Lock, RotateCcw, Sprout, Star, Trophy } from 'lucide-react';

export type NodeState = 'locked' | 'current' | 'completed' | 'review-due' | 'coming-soon';
export type NodeKind = 'lesson' | 'review' | 'trophy';
type Props = {
  state: NodeState; kind: NodeKind; label: string; expanded?: boolean; controls?: string;
  celebrate?: boolean; onClick?: () => void;
};

function Icon({ state, kind }: { state: NodeState; kind: NodeKind }) {
  const props = { size: 32, strokeWidth: 2.75, 'aria-hidden': true as const };
  if (state === 'coming-soon') return <Sprout {...props} />;
  if (kind === 'trophy') return <Trophy {...props} />;
  if (state === 'locked') return <Lock {...props} />;
  if (state === 'review-due') return <RotateCcw {...props} />;
  if (kind === 'review') return state === 'completed' ? <Check {...props} strokeWidth={3.5} /> : <Dumbbell {...props} />;
  return state === 'completed' ? <Check {...props} strokeWidth={3.5} /> : <Star {...props} fill="currentColor" />;
}

/** Round path node with a solid lip. Colour comes from the surrounding unit theme class. */
export const PathNode = forwardRef<HTMLButtonElement, Props>(function PathNode({ state, kind, label, expanded, controls, celebrate, onClick }, ref) {
  const soon = state === 'coming-soon';
  return <span className={`sl-node-wrap${state === 'current' ? ' is-current' : ''}`}>
    {state === 'current' && <span className="sl-node-bubble" aria-hidden="true">시작</span>}
    <button ref={ref} type="button" className={`sl-node sl-node-${state} sl-node-kind-${kind}${celebrate ? ' is-celebrating' : ''}`}
      aria-label={label} aria-expanded={soon ? undefined : expanded} aria-controls={soon ? undefined : controls}
      disabled={soon} onClick={onClick}>
      <Icon state={state} kind={kind} />
    </button>
  </span>;
});
