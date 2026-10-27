import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { renderPage } from '@phoenix/ui/blocks';
import type { JsonSchema } from '@jsonforms/core';
import { SchemaForm, type FormLabels } from '@phoenix/ui/form';
import { today } from '../../../../../src/server/clock.ts';
import { publishedPage, siteForm } from '../../../../../src/server/content.ts';
import { getSite } from '../../../../../src/server/sites.ts';

// A portal form page: rendered per request (it shows today's date and, in the product, the
// signed-in user), never from a shared cache.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ site: string; form: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site: key, form: slug } = await params;
  const site = getSite(key);
  const found = site && siteForm(site, slug);
  return { title: found ? found.form.messages[site.locale]?.title : undefined };
}

export default async function FormPage({ params }: Props) {
  const { site: key, form: slug } = await params;
  const site = getSite(key);
  if (!site) notFound();
  setRequestLocale(site.locale);
  const found = siteForm(site, slug);
  const messages = found?.form.messages[site.locale];
  if (!found || !messages) notFound();

  const tb = await getTranslations('blocks');
  const labels = (await getMessages()).form as unknown as FormLabels;
  const ctx = {
    locale: site.locale,
    calendar: site.calendar,
    labels: { mainNav: tb('mainNav'), footerNav: tb('footerNav'), openService: tb('openService') },
  };
  // The site chrome (header and footer) comes from the published home page tree.
  const home = publishedPage(site, 'home');
  const chrome = home ? renderPage(home, ctx) : { header: [], footer: [] };
  const uischema = translateGroupLabels(found.form.uischema, messages);

  return (
    <>
      {chrome.header}
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 outline-none">
        <h1 className="text-3xl font-bold text-fg">{messages.title}</h1>
        {messages.intro && <p className="mb-6 mt-2 text-fg-muted">{messages.intro}</p>}
        <SchemaForm
          schema={found.form.schema as JsonSchema}
          uischema={uischema as never}
          messages={{ locale: site.locale, form: messages, labels }}
          calendar={site.calendar}
          dir={site.dir}
          today={today(site.timeZone)}
          action={`/forms/${slug}/submit`}
        />
      </main>
      {chrome.footer}
    </>
  );
}

/** Group labels in the UI schema are message keys; this resolves them for the viewer. */
function translateGroupLabels(
  node: Record<string, unknown>,
  messages: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (typeof node.label === 'string') out.label = messages[node.label] ?? node.label;
  if (Array.isArray(node.elements)) {
    out.elements = node.elements.map((child) =>
      translateGroupLabels(child as Record<string, unknown>, messages),
    );
  }
  return out;
}
