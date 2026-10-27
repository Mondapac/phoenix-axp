import { useId } from 'react';
import { DataLink } from './link.tsx';
import { list, text, type BlockContext } from './types.ts';

export interface CardGridProps {
  title: string;
  /** In-page anchor (#news), letters, digits and dashes only. */
  anchor: string;
  cards: { title: string; body: string; href: string }[];
}

export const readCardGrid = (p: Record<string, unknown>): CardGridProps => ({
  title: text(p.title),
  anchor: /^[a-z][a-z0-9-]{0,40}$/.test(text(p.anchor)) ? text(p.anchor) : '',
  cards: list(p.cards, (card) => ({
    title: text(card.title),
    body: text(card.body),
    href: text(card.href),
  })),
});

export function CardGrid({ title, anchor, cards, ctx }: CardGridProps & { ctx: BlockContext }) {
  const id = useId();
  return (
    <section id={anchor || undefined} aria-labelledby={id} className="bg-subtle">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 id={id} className="mb-6 text-2xl font-bold text-fg">
          {title}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, index) => (
            <li
              key={index}
              className="flex flex-col rounded-card border border-line bg-surface p-5 text-start"
            >
              <h3 className="text-lg font-semibold text-fg">{card.title}</h3>
              <p className="mt-2 grow text-fg-muted">{card.body}</p>
              <DataLink href={card.href} className="mt-4 self-start font-semibold">
                {ctx.labels.openService}
                <span className="sr-only">: {card.title}</span>
              </DataLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
