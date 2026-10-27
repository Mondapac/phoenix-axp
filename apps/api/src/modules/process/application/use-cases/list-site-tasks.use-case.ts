import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import { PROCESS_TASKS_ASSIGN } from '../../contracts/permissions';
import type { ProcessRepository } from '../process.repository';
import { INBOX_KEYS, inboxTaskOf, staffOf, type InboxTask, type TaskInbox } from '../task-inbox';
import { MAX_INBOX_TASKS } from './list-my-tasks.use-case';

export interface ListSiteTasksInput {
  /** 1 to {@link MAX_INBOX_TASKS}. */
  readonly limit: number;
}

/** Tasks read per call, already narrowed to the sites the caller supervises. */
const CANDIDATES = 500;

/**
 * The supervisor's view (ADR-0025): every open task at the sites where the caller holds the
 * assign key, held or not, so it can give one to a person; by due time, then age.
 */
export class ListSiteTasks extends UseCase<ListSiteTasksInput, InboxTask[]> {
  static override readonly access: AccessDeclaration = {
    name: 'process.list-site-tasks',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_ASSIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly inbox: TaskInbox,
    private readonly repository: ProcessRepository,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ListSiteTasksInput,
  ): Promise<Result<InboxTask[], never>> {
    const actor = staffOf(context);
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_INBOX_TASKS);
    const holdings = await this.inbox.holdingsOf(context, actor.accountId);
    const sites = await holdings.sitesHolding(INBOX_KEYS.assign);
    const candidates = await this.inbox.read(context.tenant, () =>
      this.repository.openTasksByDue(context.tenant, sites, CANDIDATES),
    );
    const now = this.inbox.now();
    const tasks: InboxTask[] = [];
    // The query read only the supervised sites; the check stays, against the same answer.
    const supervised = (siteId: Id<'Site'> | null) =>
      sites === 'all' || (siteId !== null && sites.includes(siteId));
    for (const task of candidates) {
      if (tasks.length === limit) break;
      if (supervised(task.siteId)) tasks.push(inboxTaskOf(task, now));
    }
    return ok(tasks);
  }
}
