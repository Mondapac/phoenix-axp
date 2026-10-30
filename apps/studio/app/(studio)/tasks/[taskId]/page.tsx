import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Ltr,
  PageContainer,
  PageHeader,
} from '@phoenix/ui';
import { FileText } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isId } from '../../../_lib/structure';
import { standingOf, type InboxTask } from '../../../_lib/process';
import { readForPage, studioSession } from '../../../_server/session';
import { NoAccess, PageCrumbs } from '../../_components/page-parts';
import { taskNames } from '../_parts/task-names';
import { DueText, StandingBadge, taskLabel } from '../_parts/task-parts';
import { AssignTaskDialog, TaskActions } from './task-actions';

// One task of the inbox (GET process/tasks/:id): where it stands, its deadline and what the
// member can do with it. Another site's or queue's task answers as not found.

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  if (!isId(taskId)) notFound();
  const session = await studioSession();
  const { t, tenant, held, accountId, csrfToken } = session;
  const [task, names] = await Promise.all([
    readForPage<InboxTask>(`process/tasks/${taskId}`),
    taskNames(session),
  ]);
  const crumbs = [{ label: t['tasks.title'], href: '/tasks' }];
  if (task === null) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={<PageCrumbs t={t} items={crumbs} />} title={t['tasks.title']} />
        <NoAccess t={t} />
      </PageContainer>
    );
  }
  const dates = {
    locale: tenant.defaultLocale,
    calendar: tenant.calendar,
    timeZone: tenant.timeZone,
  };
  const standing = standingOf(task, accountId);
  const supervises = held.has('process.tasks.assign') && task.status === 'open';
  const people = [...names.people]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, tenant.defaultLocale));

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<PageCrumbs t={t} items={[...crumbs, { label: taskLabel(task) }]} />}
        title={<bdi>{taskLabel(task)}</bdi>}
        actions={
          supervises && names.people.size > 0 ? (
            <AssignTaskDialog t={t} csrfToken={csrfToken} taskId={task.id} people={people} />
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t['task.decide']}</CardTitle>
            </CardHeader>
            <CardContent>
              {standing === 'mine' || standing === 'queue' ? (
                <TaskActions
                  t={t}
                  csrfToken={csrfToken}
                  taskId={task.id}
                  standing={standing}
                  outcomes={task.outcomes}
                  releasable={task.queueRoleId !== null}
                />
              ) : (
                <p className="text-sm text-fg-muted">{t[`task.standingHelp.${standing}`]}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t['task.form']}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={<FileText aria-hidden />}
                title={task.formRevisionId === null ? t['task.form.none'] : t['task.form.later']}
                description={
                  task.formRevisionId === null ? t['task.form.noneHelp'] : t['task.form.laterHelp']
                }
              />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t['task.details']}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              <Detail label={t['tasks.col.standing']}>
                <StandingBadge t={t} task={task} standing={standing} names={names} />
              </Detail>
              <Detail label={t['tasks.col.due']}>
                <DueText t={t} task={task} dates={dates} />
              </Detail>
              <Detail label={t['tasks.col.site']}>
                <bdi>{(task.siteId && names.sites.get(task.siteId)) || t['task.unknownSite']}</bdi>
              </Detail>
              {task.outcomes.length === 0 ? null : (
                <Detail label={t['task.outcomes']}>
                  <span className="flex flex-wrap gap-1.5">
                    {task.outcomes.map((outcome) => (
                      <Ltr key={outcome} className="rounded-pill bg-subtle px-2 py-0.5 text-xs">
                        {outcome}
                      </Ltr>
                    ))}
                  </span>
                </Detail>
              )}
              <Detail label={t['task.key']}>
                <Ltr className="break-all text-fg-muted">{task.taskKey}</Ltr>
              </Detail>
            </dl>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}
