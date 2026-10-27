import { DataLink } from './link.tsx';
import { list, text, type BlockContext } from './types.ts';

export interface SiteHeaderProps {
  siteName: string;
  tagline: string;
  nav: { label: string; href: string }[];
}

export const readSiteHeader = (p: Record<string, unknown>): SiteHeaderProps => ({
  siteName: text(p.siteName),
  tagline: text(p.tagline),
  nav: list(p.nav, (item) => ({ label: text(item.label), href: text(item.href) })),
});

export function SiteHeader({
  siteName,
  tagline,
  nav,
  ctx,
}: SiteHeaderProps & { ctx: BlockContext }) {
  return (
    <header className="bg-brand text-on-brand">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4">
        <div className="me-auto">
          <a href="/" className="text-xl font-bold text-on-brand no-underline">
            {siteName}
          </a>
          {tagline && <p className="text-sm text-on-brand">{tagline}</p>}
        </div>
        <nav aria-label={ctx.labels.mainNav}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {nav.map((item, index) => (
              <li key={index}>
                <DataLink
                  href={item.href}
                  className="text-on-brand underline-offset-4 hover:underline"
                >
                  {item.label}
                </DataLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
