import {
  Card,
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
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { standingOf, type InboxTask } from '../../_lib/process';
import { readForPage, studioSession } from '../../_server/session';
import { NoAccess, PageCrumbs } from '../_components/page-parts';
import { taskNames } from './_parts/task-names';
import { DueText, StandingBadge, taskLabel } from './_parts/task-parts';
import { ViewSwitch } from './_parts/view-switch';

// "My tasks" (GET process/tasks, ADR-0025, owner decision D3): the tasks the member holds and
// those waiting in its queues, by deadline. A supervisor (`process.tasks.assign`) also has every
// open task at its sites (GET process/tasks/supervised). The API reads at most 500 tasks.

const COLUMNS = ['38%', '22%', '22%', '18%'];
const LIMIT = 200;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await studioSession();
  const { t, tenant, held, accountId } = session;
  const supervises = held.has('process.tasks.assign');
  const view = supervises && (await searchParams).view === 'supervised' ? 'supervised' : 'mine';
  const [listed, names] = await Promise.all([
    readForPage<{ items: InboxTask[] }>(
      view === 'supervised'
        ? `process/tasks/supervised?limit=${LIMIT}`
        : `process/tasks?limit=${LIMIT}`,
    ),
    taskNames(session),
  ]);
  const dates = {
    locale: tenant.defaultLocale,
    calendar: tenant.calendar,
    timeZone: tenant.timeZone,
  };
  const tasks = listed?.items ?? [];
  const site = (task: InboxTask) =>
    task.siteId === null ? '' : (names.sites.get(task.siteId) ?? '');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[{ label: t['tasks.title'] }]} />}
        title={t['tasks.title']}
        description={t['tasks.description']}
      />
      {supervises ? <ViewSwitch t={t} view={view} /> : null}
      <Card>
        {listed === null ? (
          <NoAccess t={t} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden />}
            title={t[view === 'mine' ? 'tasks.empty.title' : 'tasks.emptySupervised.title']}
            description={
              t[view === 'mine' ? 'tasks.empty.description' : 'tasks.emptySupervised.description']
            }
          />
        ) : (
          <>
            <ul className="sm:hidden">
              {tasks.map((task) => (
                <li key={task.id} className="border-b border-line last:border-b-0">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="block space-y-1.5 px-4 py-3 hover:bg-hover"
                  >
                    <span className="block truncate font-medium text-fg">
                      <bdi>{taskLabel(task)}</bdi>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <StandingBadge
                        t={t}
                        task={task}
                        standing={standingOf(task, accountId)}
                        names={names}
                      />
                      {site(task) === '' ? null : (
                        <span className="truncate text-fg-muted">
                          <bdi>{site(task)}</bdi>
                        </span>
                      )}
                    </span>
                    <span className="block text-sm">
                      <DueText t={t} task={task} dates={dates} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="max-sm:hidden">
              <Table columns={COLUMNS} className="min-w-[40rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t['tasks.col.task']}</TableHead>
                    <TableHead>{t['tasks.col.standing']}</TableHead>
                    <TableHead>{t['tasks.col.due']}</TableHead>
                    <TableHead>{t['tasks.col.site']}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="truncate">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="font-medium text-fg hover:text-accent"
                        >
                          <bdi>{taskLabel(task)}</bdi>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StandingBadge
                          t={t}
                          task={task}
                          standing={standingOf(task, accountId)}
                          names={names}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        <DueText t={t} task={task} dates={dates} />
                      </TableCell>
                      <TableCell className="truncate text-fg-muted">
                        <bdi>{site(task)}</bdi>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {tasks.length >= LIMIT ? (
              <p className="border-t border-line px-4 py-3 text-sm text-fg-muted">
                {t['tasks.truncated']}
              </p>
            ) : null}
          </>
        )}
      </Card>
    </PageContainer>
  );
}
