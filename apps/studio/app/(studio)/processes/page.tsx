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
import { Workflow } from 'lucide-react';
import Link from 'next/link';
import { fill } from '../../_i18n/messages';
import { formatInstantDate } from '../../_lib/format';
import type { DefinitionSummary } from '../../_lib/process';
import { readForPage, studioSession } from '../../_server/session';
import { NoAccess, PageCrumbs } from '../_components/page-parts';
import { CreateProcessDialog } from './processes-client';

// The tenant's processes for the modeler (GET process/definitions, slice 2.10): each key with
// its draft and its latest published revision. Designing needs `process.definitions.design`;
// publishing is the separate `process.definitions.publish` (owner decision D7).

const COLUMNS = ['40%', '30%', '30%'];

export default async function ProcessesPage() {
  const { t, tenant, held, csrfToken } = await studioSession();
  const listed = await readForPage<{ items: DefinitionSummary[]; truncated: boolean }>(
    'process/definitions',
  );
  const locale = tenant.defaultLocale;
  const dates = { locale, calendar: tenant.calendar, timeZone: tenant.timeZone };
  const items = listed?.items ?? [];

  const draftCell = (item: DefinitionSummary) =>
    item.draft === null ? (
      <span className="text-fg-muted">{t['processes.noDraft']}</span>
    ) : (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="info">
          {fill(t['modeler.state.draft'], { version: formatNumber(item.draft.version, locale) })}
        </Badge>
        <span className="text-fg-muted">{formatInstantDate(item.draft.updatedAt, dates)}</span>
      </span>
    );
  const publishedCell = (item: DefinitionSummary) =>
    item.published === null ? (
      <span className="text-fg-muted">{t['processes.notPublished']}</span>
    ) : (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="success">
          {fill(t['modeler.state.published'], {
            revision: formatNumber(item.published.revision, locale),
          })}
        </Badge>
        <span className="text-fg-muted">
          {formatInstantDate(item.published.publishedAt, dates)}
        </span>
      </span>
    );

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[{ label: t['processes.title'] }]} />}
        title={t['processes.title']}
        description={t['processes.description']}
        actions={
          listed !== null && held.has('process.definitions.design') ? (
            <CreateProcessDialog
              t={t}
              csrfToken={csrfToken}
              taken={items.map((item) => item.processKey)}
            />
          ) : null
        }
      />
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Workflow aria-hidden />}
            title={t['processes.empty.title']}
            description={t['processes.empty.description']}
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {items.map((item) => (
                <li
                  key={item.processKey}
                  className="space-y-2 border-b border-line px-4 py-3 last:border-b-0"
                >
                  <Link
                    href={`/processes/${item.processKey}`}
                    className="block truncate font-medium text-fg hover:text-accent"
                  >
                    <Ltr>{item.processKey}</Ltr>
                  </Link>
                  <div className="space-y-1 text-sm">
                    {draftCell(item)}
                    {publishedCell(item)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={COLUMNS} className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['processes.col.key']}</TableHead>
                    <TableHead>{t['processes.col.draft']}</TableHead>
                    <TableHead>{t['processes.col.published']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.processKey}>
                      <TableCell className="truncate">
                        <Link
                          href={`/processes/${item.processKey}`}
                          className="font-medium text-fg hover:text-accent"
                        >
                          <Ltr>{item.processKey}</Ltr>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{draftCell(item)}</TableCell>
                      <TableCell className="text-sm">{publishedCell(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {listed.truncated ? (
              <p className="border-t border-line px-4 py-3 text-sm text-fg-muted">
                {t['processes.truncated']}
              </p>
            ) : null}
          </>
        )}
      </Card>
    </PageContainer>
  );
}
