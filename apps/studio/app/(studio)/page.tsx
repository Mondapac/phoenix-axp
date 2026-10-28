import { PageContainer, PageHeader } from '@phoenix/ui';
import { messagesFor } from '../_i18n/messages';
import { tenantPresentation } from '../_server/panel';

/** The studio's dashboard. Its widgets come with the modules that feed them. */
export default async function HomePage() {
  const tenant = await tenantPresentation();
  const t = messagesFor(tenant.defaultLocale);
  return (
    <PageContainer>
      <PageHeader title={t['home.title']} description={t['home.description']} />
    </PageContainer>
  );
}
