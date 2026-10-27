import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import { PROCESS_TASKS_WORK } from '../../contracts/permissions';
import { inInbox } from '../../domain/task-access';
import type { ProcessRepository } from '../process.repository';
import { INBOX_KEYS, inboxTaskOf, staffOf, type InboxTask, type TaskInbox } from '../task-inbox';

export interface ListMyTasksInput {
  /** 1 to {@link MAX_INBOX_TASKS}. */
  readonly limit: number;
}

export const MAX_INBOX_TASKS = 100;
/**
 * Candidates read per call, already narrowed to the sites where the caller holds the work key;
 * the rules then check each against its own site, and the inbox shows the first that pass.
 */
const CANDIDATES = 500;

/**
 * "My tasks" (ADR-0025; owner decision D3): the open tasks the caller holds, and the open
 * tasks nobody holds yet in the queues of its roles at the sites its grants cover; by due time,
 * then age. A task moves out of a queue once its deadline escalates it.
 */
export class ListMyTasks extends UseCase<ListMyTasksInput, InboxTask[]> {
  static override readonly access: AccessDeclaration = {
    name: 'process.list-my-tasks',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_WORK.key] },
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
    input: ListMyTasksInput,
  ): Promise<Result<InboxTask[], never>> {
    const actor = staffOf(context);
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_INBOX_TASKS);
    const holdings = await this.inbox.holdingsOf(context, actor.accountId);
    const sites = await holdings.sitesHolding(INBOX_KEYS.work);
    const candidates = await this.inbox.read(context.tenant, () =>
      this.repository.inboxCandidates(
        context.tenant,
        actor.accountId,
        holdings.roleIds,
        sites,
        CANDIDATES,
      ),
    );
    const now = this.inbox.now();
    const mine: InboxTask[] = [];
    for (const task of candidates) {
      if (mine.length === limit) break;
      if (inInbox(task, actor.accountId, await holdings.at(task.siteId), INBOX_KEYS.work, now)) {
        mine.push(inboxTaskOf(task, now));
      }
    }
    return ok(mine);
  }
}
