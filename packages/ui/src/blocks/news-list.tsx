import { useId } from 'react';
import { formatDate, isoToEpochDay } from '../calendar/calendar.ts';
import { DataLink } from './link.tsx';
import { list, text, type BlockContext } from './types.ts';

export interface NewsListProps {
  title: string;
  /** In-page anchor (#news), letters, digits and dashes only. */
  anchor: string;
  items: { title: string; date: string; summary: string; href: string }[];
}

export const readNewsList = (p: Record<string, unknown>): NewsListProps => ({
  title: text(p.title),
  anchor: /^[a-z][a-z0-9-]{0,40}$/.test(text(p.anchor)) ? text(p.anchor) : '',
  items: list(p.items, (item) => ({
    title: text(item.title),
    date: text(item.date),
    summary: text(item.summary),
    href: text(item.href),
  })),
});

export function NewsList({ title, anchor, items, ctx }: NewsListProps & { ctx: BlockContext }) {
  const id = useId();
  return (
    <section id={anchor || undefined} aria-labelledby={id} className="mx-auto max-w-6xl px-4 py-10">
      <h2 id={id} className="mb-6 text-2xl font-bold text-fg">
        {title}
      </h2>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((item, index) => (
          <li key={index} className="py-5">
            <article>
              <h3 className="text-lg font-semibold">
                <DataLink href={item.href}>{item.title}</DataLink>
              </h3>
              {isoToEpochDay(item.date) !== null && (
                <p className="text-sm text-fg-muted">
                  <time dateTime={item.date}>{formatDate(item.date, ctx)}</time>
                </p>
              )}
              {item.summary && <p className="mt-2 text-fg">{item.summary}</p>}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
