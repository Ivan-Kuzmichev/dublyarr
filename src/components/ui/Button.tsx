import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-semibold hover:bg-accent-hover',
  secondary: 'border border-line-strong text-text hover:bg-surface-2',
  ghost: 'text-text-2 hover:bg-surface-2',
  destructive: 'bg-destructive text-text font-semibold hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  sm: 'h-[38px] px-3.5 text-[13px] rounded-[10px]',
  md: 'h-11 px-[18px] text-sm rounded-[11px]',
  lg: 'h-[52px] px-6 text-base rounded-xl',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
