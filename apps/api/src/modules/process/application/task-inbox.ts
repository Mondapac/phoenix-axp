import { ok } from '@phoenix/shared-kernel';
import type {
  AuthenticatedActor,
  CallContext,
  Clock,
  Id,
  Temporal,
  TenantContext,
} from '@phoenix/shared-kernel';
import type { RoleHoldingReader, SiteAncestryReader } from '../../../platform/authz';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import { PROCESS_TASKS_ASSIGN, PROCESS_TASKS_WORK } from '../contracts/permissions';
import { canSee, isOverdue, type HoldingAtSite } from '../domain/task-access';
import { HoldingsAtSites } from './inbox-access';
import type { ProcessRepository, TaskRecord } from './process.repository';

/** The keys the inbox rules read. */
export const INBOX_KEYS = Object.freeze({
  work: PROCESS_TASKS_WORK.key,
  assign: PROCESS_TASKS_ASSIGN.key,
});

/** A task as the inbox answers it: ids, codes and times, never form data (ADR-0024). */
export interface InboxTask {
  readonly id: Id<'ProcessTask'>;
  readonly instanceId: Id<'ProcessInstance'>;
  readonly taskKey: string;
  readonly name: string | null;
  readonly formKey: string | null;
  /** The form revision the task shows, pinned when its process revision was published. */
  readonly formRevisionId: Id<'FormRevision'> | null;
  /** `open`, or `completing` while the engine applies the holder's decision. */
  readonly status: string;
  readonly siteId: Id<'Site'> | null;
  readonly queueRoleId: Id<'Role'> | null;
  readonly assigneeAccountId: Id<'Account'> | null;
  readonly dueAt: Temporal.Instant | null;
  readonly overdue: boolean;
  readonly escalatedAt: Temporal.Instant | null;
  readonly outcomes: readonly string[];
  readonly version: number;
}

export const inboxTaskOf = (task: TaskRecord, now: Temporal.Instant): InboxTask => ({
  id: task.id,
  instanceId: task.instanceId,
  taskKey: task.taskKey,
  name: task.name,
  formKey: task.formKey,
  formRevisionId: task.formRevisionId,
  status: task.status,
  siteId: task.siteId,
  queueRoleId: task.candidateRoleId,
  assigneeAccountId: task.assigneeAccountId,
  dueAt: task.dueAt,
  overdue: isOverdue(task, now),
  escalatedAt: task.escalatedAt,
  outcomes: task.outcomes,
  version: task.version,
});

/**
 * What the inbox use cases share (ADR-0025): the task read in a read-only unit, and the
 * actor's holdings resolved against its site outside any unit (identity and the site tree are
 * read through their ports, each in a unit of its own, never inside the caller's).
 */
export class TaskInbox {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly holdings: RoleHoldingReader,
    private readonly sites: SiteAncestryReader,
    private readonly clock: Clock,
  ) {}

  now(): Temporal.Instant {
    return this.clock.now();
  }

  /** The holdings of `accountId` (the actor's own by default), resolvable per site. */
  holdingsOf(context: CallContext, accountId: Id<'Account'>): Promise<HoldingsAtSites> {
    return HoldingsAtSites.of(context, accountId, this.holdings, this.sites);
  }

  /**
   * The task with the actor's holdings at its site, or null when the task does not exist for
   * the actor (unknown, or not one it may see).
   */
  async visibleTask(
    context: CallContext,
    actor: AuthenticatedActor,
    taskId: string,
  ): Promise<{ task: TaskRecord; at: HoldingAtSite[]; holdings: HoldingsAtSites } | null> {
    const task = await this.read(context.tenant, () =>
      this.repository.findTask(context.tenant, taskId),
    );
    if (task === null) return null;
    const holdings = await this.holdingsOf(context, actor.accountId);
    const at = await holdings.at(task.siteId);
    return canSee(task, actor.accountId, at, INBOX_KEYS) ? { task, at, holdings } : null;
  }

  async read<T>(tenant: TenantContext, work: () => Promise<T>): Promise<T> {
    const result = await this.unitOfWork.run(tenant, async () => ok(await work()), {
      readOnly: true,
    });
    if (!result.ok) throw new Error('unreachable: a read unit returned err');
    return result.value;
  }
}

/** The authenticated actor of a `permissions` use case: the gate admits no other kind. */
export function staffOf(context: CallContext): AuthenticatedActor {
  if (context.actor.kind !== 'authenticated') {
    throw new Error('unreachable: the gate admits only an authenticated actor here');
  }
  return context.actor;
}
