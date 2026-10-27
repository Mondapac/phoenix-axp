import { DataLink } from './link.tsx';
import { text } from './types.ts';

export interface HeroProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
}

export const readHero = (p: Record<string, unknown>): HeroProps => ({
  title: text(p.title),
  subtitle: text(p.subtitle),
  ctaLabel: text(p.ctaLabel),
  ctaHref: text(p.ctaHref),
});

export function Hero({ title, subtitle, ctaLabel, ctaHref }: HeroProps) {
  return (
    <section className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold leading-snug text-fg">{title}</h1>
        {subtitle && <p className="mt-3 max-w-prose text-lg text-fg-muted">{subtitle}</p>}
        {ctaLabel && (
          <DataLink
            href={ctaHref}
            className="mt-6 inline-block rounded-control bg-accent px-5 py-3 font-semibold text-on-accent no-underline hover:bg-accent-hover"
          >
            {ctaLabel}
          </DataLink>
        )}
      </div>
    </section>
  );
}
