import { cn } from '../lib/cn';

// The button look as class names, without React: server components use it to style a link as a
// button (a client module's function cannot be called from the server).

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-subtle text-fg hover:bg-hover',
  outline: 'border border-line-strong bg-surface text-fg hover:bg-subtle',
  ghost: 'bg-transparent text-fg hover:bg-subtle',
  danger: 'bg-critical text-on-critical hover:bg-critical-hover',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-base',
  icon: 'size-10',
  'icon-sm': 'size-8',
};

export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    VARIANTS[variant],
    SIZES[size],
  );
