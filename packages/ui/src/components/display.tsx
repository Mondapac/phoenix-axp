'use client';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// Tabs ---------------------------------------------------------------------------------------

export const Tabs = BaseTabs.Root;

/** The tab strip: scrolls sideways on a narrow screen instead of wrapping. */
export function TabList({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.List>, 'className'> & { className?: string }) {
  return (
    <BaseTabs.List
      className={cn('relative flex gap-1 overflow-x-auto border-b border-line', className)}
      {...props}
    />
  );
}

export function Tab({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.Tab>, 'className'> & { className?: string }) {
  return (
    <BaseTabs.Tab
      className={cn(
        '-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-fg-muted hover:text-fg data-[active]:border-accent data-[active]:text-accent-fg',
        className,
      )}
      {...props}
    />
  );
}

export function TabPanel({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.Panel>, 'className'> & { className?: string }) {
  return <BaseTabs.Panel className={cn('pt-4', className)} {...props} />;
}

// Avatar -------------------------------------------------------------------------------------

/** A person's picture, or their initials when there is none. */
export function Avatar({
  src,
  name,
  initials,
  size = 'md',
}: {
  src?: string;
  /** The person's name, the image's alternative text. */
  name: string;
  initials: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <BaseAvatar.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-accent-subtle font-semibold text-accent-fg',
        { sm: 'size-8 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' }[size],
      )}
    >
      {src ? <BaseAvatar.Image src={src} alt={name} className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback role="img" aria-label={name}>
        {initials}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

// Separator, skeleton, empty state -----------------------------------------------------------

export function Separator({
  orientation = 'horizontal',
}: {
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={orientation === 'horizontal' ? 'h-px w-full bg-line' : 'w-px self-stretch bg-line'}
    />
  );
}

/** A placeholder block while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-subtle', className)} />;
}

/** What a list or page shows when it has nothing yet, with the next step as the action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      {icon ? (
        <div className="flex size-12 items-center justify-center rounded-pill bg-subtle text-fg-muted [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-md text-sm text-fg-muted">{description}</p> : null}
      {action}
    </div>
  );
}
