import { Badge } from '@phoenix/ui';
import { fill, type Messages } from '../../../_i18n/messages';
import { formatInstantDateTime, type DateContext } from '../../../_lib/format';
import type { InboxTask, TaskStanding } from '../../../_lib/process';

// Server-rendered parts shared by the inbox and the task page: the reading of a task's ids
// through the names the member may read (an id it cannot read shows as a role or a person).

export interface TaskNames {
  readonly sites: ReadonlyMap<string, string>;
  readonly roles: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
}

/** The task's label: its name in the model, else its key (plain text, never markup). */
export const taskLabel = (task: InboxTask): string => task.name ?? task.taskKey;

export function StandingBadge(props: {
  readonly t: Messages;
  readonly task: InboxTask;
  readonly standing: TaskStanding;
  readonly names: TaskNames;
}) {
  const { t, task, standing, names } = props;
  switch (standing) {
    case 'mine':
      return <Badge tone="accent">{t['tasks.standing.mine']}</Badge>;
    case 'queue':
      return (
        <Badge>
          {fill(t['tasks.standing.queue'], {
            role: names.roles.get(task.queueRoleId ?? '') ?? t['tasks.someRole'],
          })}
        </Badge>
      );
    case 'unassigned':
      return <Badge tone="warning">{t['tasks.standing.unassigned']}</Badge>;
    case 'other':
      return (
        <Badge>
          {fill(t['tasks.standing.other'], {
            person: names.people.get(task.assigneeAccountId ?? '') ?? t['tasks.somePerson'],
          })}
        </Badge>
      );
    case 'completing':
      return <Badge tone="info">{t['tasks.standing.completing']}</Badge>;
    case 'closed':
      return <Badge>{t['tasks.standing.closed']}</Badge>;
  }
}

/** The deadline: its date and time, marked when it passed or the task escalated. */
export function DueText(props: {
  readonly t: Messages;
  readonly task: InboxTask;
  readonly dates: DateContext;
}) {
  const { t, task, dates } = props;
  if (task.dueAt === null) return <span className="text-fg-muted">{t['tasks.noDeadline']}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={task.overdue ? 'text-critical' : undefined}>
        {formatInstantDateTime(task.dueAt, dates)}
      </span>
      {task.overdue ? <Badge tone="critical">{t['tasks.overdue']}</Badge> : null}
      {task.escalatedAt === null ? null : <Badge tone="warning">{t['tasks.escalated']}</Badge>}
    </span>
  );
}
