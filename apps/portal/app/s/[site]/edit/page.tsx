import { notFound } from 'next/navigation';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Data } from '@puckeditor/core';
import { publishedPage } from '../../../../src/server/content.ts';
import { getSite } from '../../../../src/server/sites.ts';
import { Editor } from '../../../../src/puck/editor.tsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const editor = (await getMessages()).editor as { title?: string } | undefined;
  return { title: editor?.title };
}

type Props = {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ ltr?: string }>;
};

/** Spike only: the Puck editor on the site's home page tree (the product puts it in studio). */
export default async function EditPage({ params, searchParams }: Props) {
  const site = getSite((await params).site);
  if (!site) notFound();
  setRequestLocale(site.locale);
  const page = publishedPage(site, 'home');
  if (!page) notFound();
  const t = await getTranslations('blocks');
  const editor = ((await getMessages()).editor ?? {}) as {
    title?: string;
    dictionary?: Record<string, string>;
    blocks?: Record<string, string>;
    fields?: Record<string, string>;
  };
  const { _version, ...data } = page;
  return (
    <Editor
      data={data as unknown as Data}
      ctx={{
        locale: site.locale,
        calendar: site.calendar,
        labels: { mainNav: t('mainNav'), footerNav: t('footerNav'), openService: t('openService') },
      }}
      dictionary={editor.dictionary ?? {}}
      labels={{ blocks: editor.blocks ?? {}, fields: editor.fields ?? {} }}
      title={editor.title ?? ''}
      ltrFields={(await searchParams).ltr !== '0'}
    />
  );
}
