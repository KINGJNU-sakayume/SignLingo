import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ChunkyVariant = 'primary' | 'secondary' | 'sky' | 'danger' | 'sun' | 'ghost';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ChunkyVariant; size?: 'md' | 'sm'; block?: boolean };

/** Tactile button: flat face with a solid lip that collapses when pressed. */
export const ChunkyButton = forwardRef<HTMLButtonElement, Props>(function ChunkyButton(
  { variant = 'primary', size = 'md', block = false, className = '', type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={`sl-btn sl-btn-${variant} sl-btn-${size}${block ? ' sl-btn-block' : ''} ${className}`.trim()} {...rest} />;
});
