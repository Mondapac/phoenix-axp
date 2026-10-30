import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { formatNumber } from '../locale/locale';
import { buttonClasses } from './button-classes';
import { DirectionalIcon } from './bidi';

export interface Crumb {
  label: ReactNode;
  href?: string;
}

/** The page's place in the panel. The last crumb is the current page. */
export function Breadcrumb({ items, label }: { items: Crumb[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {item.href && !last ? (
                <a href={item.href} className="text-fg-muted no-underline hover:text-fg">
                  {item.label}
                </a>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-fg')}>
                  {item.label}
                </span>
              )}
              {last ? null : (
                <DirectionalIcon>
                  <ChevronRight className="size-3.5" aria-hidden />
                </DirectionalIcon>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Page links for a list. Numbers are shown in the locale's digits; every text comes from the
 * caller. `href(page)` builds each link, so paging works without client script.
 */
export function Pagination({
  page,
  pageCount,
  href,
  locale,
  labels,
}: {
  page: number;
  pageCount: number;
  href: (page: number) => string;
  locale: string;
  labels: { nav: string; previous: string; next: string; page: (page: string) => string };
}) {
  const pages = pageWindow(page, pageCount);
  const link = (target: number, content: ReactNode, aria: string, current = false) => (
    <a
      href={href(target)}
      aria-label={aria}
      aria-current={current ? 'page' : undefined}
      className={cn(
        buttonClasses(current ? 'primary' : 'ghost', 'icon-sm'),
        'no-underline',
        current ? 'text-on-accent' : 'text-fg',
      )}
    >
      {content}
    </a>
  );
  return (
    <nav aria-label={labels.nav} className="flex items-center gap-1">
      {page > 1
        ? link(
            page - 1,
            <DirectionalIcon>
              <ChevronLeft aria-hidden />
            </DirectionalIcon>,
            labels.previous,
          )
        : null}
      {pages.map((target, index) =>
        target === null ? (
          <span key={`gap-${index}`} className="px-1 text-fg-muted" aria-hidden>
            …
          </span>
        ) : (
          <span key={target}>
            {link(
              target,
              formatNumber(target, locale),
              labels.page(formatNumber(target, locale)),
              target === page,
            )}
          </span>
        ),
      )}
      {page < pageCount
        ? link(
            page + 1,
            <DirectionalIcon>
              <ChevronRight aria-hidden />
            </DirectionalIcon>,
            labels.next,
          )
        : null}
    </nav>
  );
}

/** The pages to show: first, last, and two either side of the current one; null is a gap. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const shown = new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2]);
  const sorted = [...shown].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((p, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && p - previous > 1) result.push(null);
    result.push(p);
  });
  return result;
}
