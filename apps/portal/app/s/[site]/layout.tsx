import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { allSiteKeys, getSite } from '../../../src/server/sites.ts';
import '../../globals.css';

export const generateStaticParams = () => allSiteKeys().map((site) => ({ site }));
export const dynamicParams = false;

/** The root layout of every site: lang and dir from the site's locale, theme from its tree. */
export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ site: string }>;
}) {
  const site = getSite((await params).site);
  if (!site) notFound();
  setRequestLocale(site.locale);
  const t = await getTranslations('layout');
  return (
    <html lang={site.locale} dir={site.dir}>
      <head>
        {/* Per-site theme as a stylesheet, not an inline style, so CSP needs no unsafe-inline. */}
        <link rel="stylesheet" href="/theme.css" />
      </head>
      <body className="min-h-screen bg-page text-fg">
        <a
          href="#main"
          className="sr-only rounded-control bg-surface p-3 font-semibold focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50"
        >
          {t('skipToContent')}
        </a>
        {children}
      </body>
    </html>
  );
}
