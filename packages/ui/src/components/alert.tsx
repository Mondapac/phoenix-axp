import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { Tone } from './badge';

const TONES: Record<Exclude<Tone, 'neutral'>, string> = {
  accent: 'border-accent bg-accent-subtle text-accent-fg',
  success: 'border-success bg-success-bg text-success',
  warning: 'border-warning bg-warning-bg text-warning',
  critical: 'border-critical bg-critical-bg text-critical',
  info: 'border-info bg-info-bg text-info',
};

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: Exclude<Tone, 'neutral'>;
  title?: ReactNode;
  icon?: ReactNode;
}

/** An inline message. `critical` is announced at once (role="alert"); the others politely. */
export function Alert({ tone = 'info', title, icon, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-control border-s-4 p-4 text-sm [&_svg]:size-5 [&_svg]:shrink-0',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg">{children}</div> : null}
      </div>
    </div>
  );
}
