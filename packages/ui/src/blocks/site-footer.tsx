import { DataLink } from './link.tsx';
import { list, text, type BlockContext } from './types.ts';

export interface SiteFooterProps {
  text: string;
  links: { label: string; href: string }[];
}

export const readSiteFooter = (p: Record<string, unknown>): SiteFooterProps => ({
  text: text(p.text),
  links: list(p.links, (item) => ({ label: text(item.label), href: text(item.href) })),
});

export function SiteFooter({ text: body, links, ctx }: SiteFooterProps & { ctx: BlockContext }) {
  return (
    <footer className="bg-brand text-on-brand">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center">
        <p className="md:me-auto">{body}</p>
        <nav aria-label={ctx.labels.footerNav}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {links.map((item, index) => (
              <li key={index}>
                <DataLink href={item.href} className="text-on-brand underline">
                  {item.label}
                </DataLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
