import { Card, PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import type { FormView, RevisionView } from '../../../../_lib/forms';
import { isId } from '../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { Designer } from './designer';

// The designer of one form: opens on its newest revision (or an empty form) and saves a new
// one. Needs `forms.forms.design`; the API refuses the save without it.

interface Props {
  readonly params: Promise<{ readonly formId: string }>;
}

export default async function DesignPage({ params }: Props) {
  const { formId } = await params;
  const { t, tenant, held, csrfToken } = await studioSession();
  if (!isId(formId)) notFound();
  const form = await readForPage<FormView>(`forms/forms/${formId}`);
  const crumbs = [
    { label: t['forms.title'], href: '/forms' },
    ...(form === null ? [] : [{ label: form.name, href: `/forms/${form.id}` }]),
    { label: t['designer.title'] },
  ];
  const latest = form?.revisions.reduce<FormView['revisions'][number] | null>(
    (best, revision) => (best === null || revision.number > best.number ? revision : best),
    null,
  );
  const revision = latest ? await readForPage<RevisionView>(`forms/revisions/${latest.id}`) : null;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={crumbs} />}
        title={form === null ? t['designer.title'] : form.name}
        description={t['designer.description']}
      />
      {form === null || !held.has('forms.forms.design') ? (
        <Card>
          <NoAccess t={t} />
        </Card>
      ) : (
        <Designer
          t={t}
          csrfToken={csrfToken}
          formId={form.id}
          revision={revision}
          locales={tenant.supportedLocales}
          defaultLocale={tenant.defaultLocale}
          calendar={tenant.calendar}
          timeZone={tenant.timeZone}
        />
      )}
    </PageContainer>
  );
}
