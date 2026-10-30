import { Card, CardContent, formatNumber, PageContainer, PageHeader } from '@phoenix/ui';
import { notFound } from 'next/navigation';
import { formatInstantDate } from '../../../../../_lib/format';
import {
  displayValue,
  isKey,
  listColumns,
  recordsPath,
  type ObjectDescription,
  type RecordView,
} from '../../../../../_lib/objects';
import { isId } from '../../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../../_server/session';
import { NoAccess, PageCrumbs } from '../../../../_components/page-parts';
import { RecordForm } from '../record-client';

// One record (GET objects/o/:key/records/:id) with the fields the member may read, and the
// description at the record's own site, which says which of them it may change there
// (ADR-0024): a view-only field shows as text, a hidden one not at all.

interface Props {
  readonly params: Promise<{ readonly key: string; readonly recordId: string }>;
}

export default async function RecordPage({ params }: Props) {
  const { key, recordId } = await params;
  const { t, tenant, held, csrfToken, sites } = await studioSession();
  if (!isKey(key) || !isId(recordId)) notFound();
  const record = await readForPage<RecordView>(`objects/o/${key}/records/${recordId}`);
  const object =
    record === null
      ? null
      : await readForPage<ObjectDescription>(`objects/o/${key}?site=${record.siteId}`);
  const crumbs = (name: string, title: string) => [
    ...(held.has('objects.definitions.view')
      ? [{ label: t['objects.title'], href: '/objects' }]
      : []),
    { label: name, href: recordsPath(key) },
    { label: title },
  ];
  if (record === null || object === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={crumbs('…', '…')} />}
          title={t['record.title']}
        />
        <Card>
          <NoAccess t={t} />
        </Card>
      </PageContainer>
    );
  }

  const ctx = {
    locale: tenant.defaultLocale,
    calendar: tenant.calendar,
    timeZone: tenant.timeZone,
  };
  const first = listColumns(object.fields, 1)[0];
  const named =
    first === undefined
      ? ''
      : displayValue(first, record.values[first.key], ctx, {
          yes: t['common.yes'],
          no: t['common.no'],
        });
  const title = named === '' ? t['record.untitled'] : named;
  const site = sites.find((s) => s.id === record.siteId);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={crumbs(object.name, title)} />}
        title={<bdi>{title}</bdi>}
        description={<bdi>{object.name}</bdi>}
      />
      <Card>
        <CardContent className="pt-5">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {site === undefined ? null : (
              <div className="min-w-0 space-y-1">
                <dt className="text-fg-muted">{t['objects.col.site']}</dt>
                <dd className="truncate text-fg">
                  <bdi>{site.name}</bdi>
                </dd>
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['record.created']}</dt>
              <dd className="truncate text-fg">{formatInstantDate(record.createdAt, ctx)}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['records.col.updated']}</dt>
              <dd className="truncate text-fg">{formatInstantDate(record.updatedAt, ctx)}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-fg-muted">{t['record.revision']}</dt>
              <dd className="text-fg">
                {formatNumber(record.revisionNumber, tenant.defaultLocale)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <RecordForm
        t={t}
        csrfToken={csrfToken}
        objectKey={key}
        ctx={ctx}
        fields={object.fields}
        record={record}
        canDelete={held.has('objects.record.delete') && object.status === 'published'}
      />
      <p className="text-xs text-fg-muted">{t['record.hiddenNote']}</p>
    </PageContainer>
  );
}
