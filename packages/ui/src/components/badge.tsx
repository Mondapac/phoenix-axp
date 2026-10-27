import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'critical' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg-muted',
  accent: 'bg-accent-subtle text-accent-fg',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  critical: 'bg-critical-bg text-critical',
  info: 'bg-info-bg text-info',
};

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: Tone;
}

/** A short status label. Numbers inside go through formatNumber for the locale's digits. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-control px-2 text-xs font-medium [&_svg]:size-3.5',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
