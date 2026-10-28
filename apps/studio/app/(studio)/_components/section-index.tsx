import Link from 'next/link';
import { visibleMenu } from '@phoenix/panel-server';
import { Card, CardDescription, CardTitle, PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { isMessageKey } from '../../_i18n/messages';
import { studioSession } from '../../_server/session';
import { STUDIO_MENU } from '../../menu';

/**
 * The page of a menu group (`/people`, `/structure`): a card for each of its entries the
 * member may see. A group the member sees nothing of is not found, as in the menu.
 */
export async function SectionIndex({ href }: { readonly href: string }) {
  const { t, held } = await studioSession();
  const section = visibleMenu(STUDIO_MENU, held, '').find((entry) => entry.href === href);
  if (section === undefined) notFound();
  const label = (key: string) => (isMessageKey(key) ? t[key] : key);
  const blurb = (key: string) => {
    const description = `${key}.description`;
    return isMessageKey(description) ? t[description] : null;
  };
  return (
    <PageContainer>
      <PageHeader title={label(section.label)} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.children.map((entry) => (
          <li key={entry.href} className="min-w-0">
            <Link href={entry.href} className="group block h-full rounded-card no-underline">
              <Card className="h-full p-5 transition-colors group-hover:border-accent">
                <CardTitle className="text-fg">{label(entry.label)}</CardTitle>
                {blurb(entry.label) === null ? null : (
                  <CardDescription className="mt-1">{blurb(entry.label)}</CardDescription>
                )}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
