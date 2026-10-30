import Link from 'next/link';
import {
  Alert,
  Card,
  CardFooter,
  DirectionalIcon,
  EmptyState,
  PageContainer,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@phoenix/ui';
import { ChevronRight, ChevronsLeft, Plus, Rows3 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatInstantDate } from '../../../../_lib/format';
import {
  displayValue,
  isKey,
  isNumeric,
  listColumns,
  recordsPath,
  type DescribedField,
  type ObjectDescription,
  type RecordPage,
} from '../../../../_lib/objects';
import { isId } from '../../../../_lib/structure';
import { readForPage, studioSession } from '../../../../_server/session';
import { LinkButton } from '../../../_components/link-button';
import { NoAccess, PageCrumbs } from '../../../_components/page-parts';

// The records of one Object (GET objects/o/:key/records), newest first, a page at a time: the
// records in the sites the member may read, each showing only the fields its field rules let
// the member read (ADR-0024). The columns are the first readable fields of the published
// revision; a hidden field is never a column.

interface Props {
  readonly params: Promise<{ readonly key: string }>;
  readonly searchParams: Promise<{ readonly before?: string | string[] }>;
}

const PAGE_SIZE = 25;

export default async function RecordsPage({ params, searchParams }: Props) {
  const { key } = await params;
  const { before } = await searchParams;
  const { t, tenant, held, sites } = await studioSession();
  if (!isKey(key)) notFound();
  const cursor = typeof before === 'string' && isId(before) ? before : null;
  const [object, page] = await Promise.all([
    readForPage<ObjectDescription>(`objects/o/${key}`),
    readForPage<RecordPage>(
      `objects/o/${key}/records?limit=${PAGE_SIZE}${cursor === null ? '' : `&before=${cursor}`}`,
    ),
  ]);
  const crumbsBase = held.has('objects.definitions.view')
    ? [{ label: t['objects.title'], href: '/objects' }]
    : [];
  if (object === null || page === null) {
    return (
      <PageContainer>
        <PageHeader
          breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: '…' }]} />}
          title={t['records.title']}
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
  const words = { yes: t['common.yes'], no: t['common.no'] };
  const columns = listColumns(object.fields);
  const showSite = sites.length > 1;
  const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? '';
  const canCreate = object.status === 'published' && object.fields.some((f) => f.create);
  const recordHref = (id: string) => `${recordsPath(key)}/${id}`;
  // The field columns share what the site and date columns leave.
  // The field columns share what the site and date columns leave: the first (the record's
  // name) weighs most, then numbers, which must not be cut.
  const share = showSite ? 66 : 82;
  const weight = (field: DescribedField, index: number) =>
    index === 0 ? 2 : isNumeric(field) ? 1.6 : 1.2;
  const total = columns.reduce((sum, field, index) => sum + weight(field, index), 0);
  const widths = [
    ...columns.map((field, index) => `${Math.floor((share * weight(field, index)) / total)}%`),
    ...(columns.length === 0 ? [`${share}%`] : []),
    ...(showSite ? ['16%'] : []),
    '18%',
  ];
  const title = (record: RecordPage['items'][number]) => {
    const first = columns[0];
    const text =
      first === undefined ? '' : displayValue(first, record.values[first.key], ctx, words);
    return text === '' ? t['record.untitled'] : text;
  };

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[...crumbsBase, { label: object.name }]} />}
        title={<bdi>{object.name}</bdi>}
        description={t['records.description']}
        actions={
          canCreate ? (
            <LinkButton href={`${recordsPath(key)}/new`}>
              <Plus aria-hidden />
              {t['records.add']}
            </LinkButton>
          ) : null
        }
      />
      {object.status === 'retired' ? <Alert tone="warning">{t['records.retired']}</Alert> : null}
      <Card>
        {page.items.length === 0 ? (
          <EmptyState
            icon={<Rows3 aria-hidden />}
            title={cursor === null ? t['records.empty.title'] : t['records.end']}
            description={cursor === null ? t['records.empty.description'] : undefined}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {page.items.map((record) => (
                <li key={record.id} className="border-b border-line last:border-b-0">
                  <Link
                    href={recordHref(record.id)}
                    className="block space-y-1 px-4 py-3 no-underline hover:bg-subtle"
                  >
                    <span className="block truncate font-medium text-fg">
                      <bdi>{title(record)}</bdi>
                    </span>
                    {columns.slice(1).map((field) => {
                      const value = displayValue(field, record.values[field.key], ctx, words);
                      return value === '' ? null : (
                        <span key={field.key} className="block truncate text-sm text-fg-muted">
                          {field.label}: <bdi>{value}</bdi>
                        </span>
                      );
                    })}
                    <span className="block truncate text-xs text-fg-muted">
                      {showSite ? (
                        <>
                          <bdi>{siteName(record.siteId)}</bdi> ·{' '}
                        </>
                      ) : null}
                      {formatInstantDate(record.updatedAt, ctx)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={widths} className="min-w-[44rem]">
                <TableHeader>
                  <TableRow>
                    {columns.length === 0 ? (
                      <TableHead>{t['record.title']}</TableHead>
                    ) : (
                      columns.map((field) => (
                        <TableHead key={field.key} numeric={isNumeric(field)} className="truncate">
                          <bdi>{field.label}</bdi>
                        </TableHead>
                      ))
                    )}
                    {showSite ? <TableHead>{t['objects.col.site']}</TableHead> : null}
                    <TableHead>{t['records.col.updated']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((record) => (
                    <TableRow key={record.id}>
                      {columns.length === 0 ? (
                        <TableCell>
                          <Link href={recordHref(record.id)} className="text-fg hover:text-accent">
                            {t['record.untitled']}
                          </Link>
                        </TableCell>
                      ) : (
                        columns.map((field, index) => (
                          <TableCell
                            key={field.key}
                            numeric={isNumeric(field)}
                            className={
                              index === 0 ? 'truncate font-medium' : 'truncate text-fg-muted'
                            }
                          >
                            {index === 0 ? (
                              <Link
                                href={recordHref(record.id)}
                                className="text-fg hover:text-accent"
                              >
                                <bdi>{title(record)}</bdi>
                              </Link>
                            ) : (
                              <bdi>{displayValue(field, record.values[field.key], ctx, words)}</bdi>
                            )}
                          </TableCell>
                        ))
                      )}
                      {showSite ? (
                        <TableCell className="truncate text-fg-muted">
                          <bdi>{siteName(record.siteId)}</bdi>
                        </TableCell>
                      ) : null}
                      <TableCell className="truncate text-fg-muted">
                        {formatInstantDate(record.updatedAt, ctx)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {cursor === null && page.next === null ? null : (
          <CardFooter className="justify-between gap-2">
            {cursor === null ? (
              <span />
            ) : (
              <LinkButton href={recordsPath(key)} variant="ghost" size="sm">
                <DirectionalIcon>
                  <ChevronsLeft aria-hidden />
                </DirectionalIcon>
                {t['records.newest']}
              </LinkButton>
            )}
            {page.next === null ? null : (
              <LinkButton
                href={`${recordsPath(key)}?before=${page.next}`}
                variant="outline"
                size="sm"
              >
                {t['records.older']}
                <DirectionalIcon>
                  <ChevronRight aria-hidden />
                </DirectionalIcon>
              </LinkButton>
            )}
          </CardFooter>
        )}
      </Card>
    </PageContainer>
  );
}
