import { PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { roleName, type Role, type StaffAccount } from '../../../_lib/people';
import { isProcessKey, type ProcessDefinition } from '../../../_lib/process';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { ProcessModeler } from './modeler';

// One process in the modeler (GET process/definitions/:key): its draft, or its latest published
// revision when it has no draft. The roles, people and published forms a step may name are read
// where the member may read them; otherwise the panel asks for the id.

interface FormListItem {
  readonly key: string;
  readonly name: string;
}

export default async function ProcessPage({ params }: { params: Promise<{ processKey: string }> }) {
  const { processKey } = await params;
  if (!isProcessKey(processKey)) notFound();
  const { t, tenant, held, csrfToken } = await studioSession();
  const [definition, roles, accounts, forms] = await Promise.all([
    readForPage<ProcessDefinition>(`process/definitions/${processKey}`),
    held.has('identity.roles.view') ? readForPage<{ items: Role[] }>('identity/roles') : null,
    held.has('identity.accounts.view')
      ? readForPage<{ items: StaffAccount[] }>('identity/staff-accounts')
      : null,
    held.has('forms.forms.view')
      ? readForPage<{ items: FormListItem[] }>('forms/forms?status=published')
      : null,
  ]);
  const crumbs = [{ label: t['processes.title'], href: '/processes' }, { label: processKey }];

  if (definition === null) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={<PageCrumbs t={t} items={crumbs} />} title={processKey} />
        <NoAccess t={t} />
      </PageContainer>
    );
  }
  const source = definition.draft ?? definition.published;
  if (source === null) notFound();
  const collator = new Intl.Collator(tenant.defaultLocale);
  const byLabel = (a: { label: string }, b: { label: string }) =>
    collator.compare(a.label, b.label);

  return (
    <PageContainer className="max-w-none">
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={crumbs} />}
        title={processKey}
        description={t['modeler.description']}
      />
      <ProcessModeler
        t={t}
        locale={tenant.defaultLocale}
        csrfToken={csrfToken}
        processKey={processKey}
        initialXml={source.bpmnXml}
        draftVersion={definition.draft?.version ?? 0}
        publishedRevision={definition.published?.revision ?? null}
        canPublish={held.has('process.definitions.publish')}
        roles={
          roles === null
            ? null
            : roles.items
                .filter((role) => role.scope !== 'platform')
                .map((role) => ({ value: role.id, label: roleName(t, role.key) }))
                .sort(byLabel)
        }
        people={
          accounts === null
            ? null
            : accounts.items
                .filter((account) => account.status === 'active')
                .map((account) => ({ value: account.id, label: account.username }))
                .sort(byLabel)
        }
        forms={
          forms === null
            ? null
            : forms.items
                .map((form) => ({ value: form.key, label: `${form.name} (${form.key})` }))
                .sort(byLabel)
        }
      />
    </PageContainer>
  );
}
