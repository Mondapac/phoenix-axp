import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageView } from '@phoenix/ui/blocks';
import { publishedPage } from '../../../src/server/content.ts';
import { getSite } from '../../../src/server/sites.ts';

// Public page: static per site, regenerated in the background (ISR). A publish would call
// revalidatePath for the page instead of waiting for the interval.
export const revalidate = 300;

type Props = { params: Promise<{ site: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = getSite((await params).site);
  const page = site && publishedPage(site, 'home');
  const header = page?.content.find((node) => node.type === 'SiteHeader');
  return { title: typeof header?.props.siteName === 'string' ? header.props.siteName : undefined };
}

export default async function HomePage({ params }: Props) {
  const site = getSite((await params).site);
  if (!site) notFound();
  setRequestLocale(site.locale);
  const page = publishedPage(site, 'home');
  if (!page) notFound();
  const t = await getTranslations('blocks');
  const ctx = {
    locale: site.locale,
    calendar: site.calendar,
    labels: { mainNav: t('mainNav'), footerNav: t('footerNav'), openService: t('openService') },
  };
  return (
    <PageView
      data={page}
      ctx={ctx}
      onUnknown={(type) => console.warn(`[portal] ${site.key}: no block registered for "${type}"`)}
    />
  );
}
