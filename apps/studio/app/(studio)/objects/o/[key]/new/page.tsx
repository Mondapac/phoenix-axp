import { Card, PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { isKey, recordsPath, subtreeOf, type ObjectDescription } from '../../../../../_lib/objects';
import { isId } from '../../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../../_components/page-parts';
import { RecordForm, RecordSitePicker } from '../record-client';

// A new record of one Object (POST objects/o/:key/records) at a site of the definition's
// subtree: the form holds only the fields the member may set there (ADR-0024 decision 6).

interface Props {
  readonly params: Promise<{ readonly key: string }>;
  readonly searchParams: Promise<{ readonly site?: string | string[] }>;
}

export default async function NewRecordPage({ params, searchParams }: Props) {
  const { key } = await params;
  const { site } = await searchParams;
  const { t, tenant, held, csrfToken, sites } = await studioSession();
  if (!isKey(key)) notFound();
  const chosen = typeof site === 'string' && isId(site) ? site : null;
  // The definition's own site (the default description) roots the sites a record may go to.
  const [home, atSite] = await Promise.all([
    readForPage<ObjectDescription>(`objects/o/${key}`),
    chosen === null ? null : readForPage<ObjectDescription>(`objects/o/${key}?site=${chosen}`),
  ]);
  const object = chosen === null ? home : atSite;
  const crumbs = (name: string) => [
    ...(held.has('objects.definitions.view')
      ? [{ label: t['objects.title'], href: '/objects' }]
      : []),
    { label: name, href: recordsPath(key) },
    { label: t['record.new'] },
  ];
  if (object === null) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={<PageCrumbs t={t} items={crumbs('…')} />} title={t['record.new']} />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }
  const subtree = home === null ? [] : subtreeOf(sites, home.siteId);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={crumbs(object.name)} />}
        title={t['record.new']}
        description={<bdi>{object.name}</bdi>}
      />
      {subtree.length > 1 ? (
        <RecordSitePicker label={t['objects.col.site']} value={object.siteId} sites={subtree} />
      ) : null}
      <RecordForm
        key={object.siteId}
        t={t}
        csrfToken={csrfToken}
        objectKey={key}
        ctx={{ locale: tenant.defaultLocale, calendar: tenant.calendar, timeZone: tenant.timeZone }}
        fields={object.status === 'published' ? object.fields : []}
        {...(chosen === null ? {} : { siteId: chosen })}
      />
    </PageContainer>
  );
}
