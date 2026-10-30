import Link from 'next/link';
import {
  Badge,
  Card,
  EmptyState,
  formatNumber,
  Ltr,
  PageContainer,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@phoenix/ui';
import { Boxes } from 'lucide-react';
import { recordsPath, STATUS_TONE, type DefinitionView } from '../../_lib/objects';
import { readForPage, studioSession } from '../../_server/session';
import { NoAccess, PageCrumbs } from '../_components/page-parts';
import { CreateObjectDialog } from './objects-client';

// The tenant's Object definitions (GET objects/definitions, ADR-0017): the ones the member may
// view, by name. Creating one needs `objects.definitions.design` at its site; the site column
// needs `tenancy.sites.view`. A published or retired Object links to its records.

const COLUMNS_WITH_SITE = ['32%', '22%', '20%', '14%', '12%'];
const COLUMNS = ['42%', '30%', '16%', '12%'];

export default async function ObjectsPage() {
  const { t, tenant, held, csrfToken, sites } = await studioSession();
  const listed = await readForPage<{ items: DefinitionView[] }>('objects/definitions');
  const locale = tenant.defaultLocale;
  const definitions = listed?.items ?? [];
  const showSite = sites.length > 0;
  const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? '';
  const records = held.has('objects.record.read');
  const recordsLink = (definition: DefinitionView) =>
    records && definition.status !== 'draft' ? (
      <Link href={recordsPath(definition.key)} className="text-accent hover:underline">
        {t['objects.openRecords']}
      </Link>
    ) : null;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[{ label: t['objects.title'] }]} />}
        title={t['objects.title']}
        description={t['objects.description']}
        actions={
          listed !== null && held.has('objects.definitions.design') && showSite ? (
            <CreateObjectDialog t={t} csrfToken={csrfToken} sites={sites} />
          ) : null
        }
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : definitions.length === 0 ? (
          <EmptyState
            icon={<Boxes aria-hidden />}
            title={t['objects.empty.title']}
            description={t['objects.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {definitions.map((definition) => (
                <li
                  key={definition.id}
                  className="space-y-1 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <Link
                      href={`/objects/${definition.id}`}
                      className="truncate font-medium text-fg hover:text-accent"
                    >
                      <bdi>{definition.name}</bdi>
                    </Link>
                    <Badge tone={STATUS_TONE[definition.status]}>
                      {t[`objectStatus.${definition.status}`]}
                    </Badge>
                  </div>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                    <Ltr className="truncate">{definition.key}</Ltr>
                    {showSite ? (
                      <span className="truncate">
                        · <bdi>{siteName(definition.siteId)}</bdi>
                      </span>
                    ) : null}
                    {recordsLink(definition) === null ? null : (
                      <span>· {recordsLink(definition)}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={showSite ? COLUMNS_WITH_SITE : COLUMNS} className="min-w-[40rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['objects.col.name']}</TableHead>
                    <TableHead>{t['objects.col.key']}</TableHead>
                    {showSite ? <TableHead>{t['objects.col.site']}</TableHead> : null}
                    <TableHead>{t['objects.col.status']}</TableHead>
                    <TableHead numeric>{t['objects.col.revisions']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definitions.map((definition) => (
                    <TableRow key={definition.id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <Link
                            href={`/objects/${definition.id}`}
                            className="truncate font-medium text-fg hover:text-accent"
                          >
                            <bdi>{definition.name}</bdi>
                          </Link>
                          {recordsLink(definition) === null ? null : (
                            <span className="text-xs">{recordsLink(definition)}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <Ltr>{definition.key}</Ltr>
                      </TableCell>
                      {showSite ? (
                        <TableCell className="truncate text-fg-muted">
                          <bdi>{siteName(definition.siteId)}</bdi>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <Badge tone={STATUS_TONE[definition.status]}>
                          {t[`objectStatus.${definition.status}`]}
                        </Badge>
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {formatNumber(definition.latestRevisionNumber, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </PageContainer>
  );
}
