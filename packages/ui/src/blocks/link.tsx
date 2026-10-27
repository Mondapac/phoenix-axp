import type { ReactNode } from 'react';
import { safeHref } from './types.ts';

/** A link from data; an unsafe or missing target renders the text without a link. */
export function DataLink({
  href,
  className,
  children,
}: {
  href: unknown;
  className?: string;
  children: ReactNode;
}) {
  const target = safeHref(href);
  if (target === null) return <span className={className}>{children}</span>;
  return (
    <a href={target} className={className}>
      {children}
    </a>
  );
}
