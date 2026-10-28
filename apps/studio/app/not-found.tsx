import { EmptyState } from '@phoenix/ui';
import { messagesFor } from './_i18n/messages';
import { tenantPresentation } from './_server/panel';

/** Not found outside the shell (Next.js's own page carries an inline style the CSP refuses). */
export default async function NotFound() {
  const t = messagesFor((await tenantPresentation()).defaultLocale);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState title={t['notFound.title']} description={t['notFound.description']} />
    </main>
  );
}
