import { Button, EmptyState, PageContainer } from '@phoenix/ui';
import { messagesFor } from '../_i18n/messages';
import { tenantPresentation } from '../_server/panel';

/** A studio page that does not exist, inside the shell. */
export default async function NotFound() {
  const tenant = await tenantPresentation();
  const t = messagesFor(tenant.defaultLocale);
  return (
    <PageContainer>
      <EmptyState
        title={t['notFound.title']}
        description={t['notFound.description']}
        action={
          <Button
            variant="secondary"
            nativeButton={false}
            render={<a href="/">{t['notFound.home']}</a>}
          />
        }
      />
    </PageContainer>
  );
}
