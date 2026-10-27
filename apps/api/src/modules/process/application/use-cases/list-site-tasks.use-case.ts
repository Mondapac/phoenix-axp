import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import { PROCESS_TASKS_ASSIGN } from '../../contracts/permissions';
import { canAssign } from '../../domain/task-access';
import type { ProcessRepository } from '../process.repository';
import { INBOX_KEYS, inboxTaskOf, staffOf, type InboxTask, type TaskInbox } from '../task-inbox';
import { MAX_INBOX_TASKS } from './list-my-tasks.use-case';

export interface ListSiteTasksInput {
  /** 1 to {@link MAX_INBOX_TASKS}. */
  readonly limit: number;
}

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
    const candidates = await this.inbox.read(context.tenant, () =>
      this.repository.openTasksByDue(context.tenant, CANDIDATES),
    );
    const now = this.inbox.now();
    const tasks: InboxTask[] = [];
    for (const task of candidates) {
      if (tasks.length === limit) break;
      if (canAssign(await holdings.at(task.siteId), INBOX_KEYS.assign)) {
        tasks.push(inboxTaskOf(task, now));
      }
    }
    return ok(tasks);
  }
}
