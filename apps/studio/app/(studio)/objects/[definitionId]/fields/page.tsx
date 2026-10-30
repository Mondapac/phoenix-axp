import { Card, PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { type DefinitionDetail, type RevisionView } from '../../../../_lib/objects';
import { isId } from '../../../../_lib/structure';
import { fill } from '../../../../_i18n/messages';
import { readForPage, studioSession } from '../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';
import { FieldsEditor } from './fields-client';

// The field designer of one Object: starts from the newest revision's fields and saves the next
// revision (POST objects/definitions/:id/revisions), which does not publish it. Needs
// `objects.definitions.design`; lowering a field's sensitivity also needs
// `objects.definitions.lower-sensitivity` (ADR-0024 decision 4).

interface Props {
  readonly params: Promise<{ readonly definitionId: string }>;
}

export default async function ObjectFieldsPage({ params }: Props) {
  const { definitionId } = await params;
  const { t, tenant, held, csrfToken } = await studioSession();
  if (!isId(definitionId)) notFound();
  const detail = await readForPage<DefinitionDetail>(`objects/definitions/${definitionId}`);
  const crumbsBase = [{ label: t['objects.title'], href: '/objects' }];
  if (detail === null || !held.has('objects.definitions.design')) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['objects.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }
  const { definition, revisions } = detail;
  const latest = revisions[0];
  const revision =
    latest === undefined ? null : await readForPage<RevisionView>(`objects/revisions/${latest.id}`);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <PageCrumbs
            t={t}
            items={[
              ...crumbsBase,
              { label: definition.name, href: `/objects/${definition.id}` },
              { label: t['object.fields'] },
            ]}
          />
        }
        title={fill(t['fieldsEdit.title'], { name: `⁨${definition.name}⁩` })}
        description={t['fieldsEdit.description']}
      />
      <FieldsEditor
        t={t}
        csrfToken={csrfToken}
        definitionId={definition.id}
        fields={revision?.fields ?? []}
        canLower={held.has('objects.definitions.lower-sensitivity')}
        locale={tenant.defaultLocale}
      />
    </PageContainer>
  );
}
