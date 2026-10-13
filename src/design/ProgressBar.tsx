export function ProgressBar({ value, max, label, valueText }: { value: number; max: number; label: string; valueText?: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return <div className="sl-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}>
    <span className="sl-progress-fill" style={{ width: `${ratio * 100}%` }} />
  </div>;
}
