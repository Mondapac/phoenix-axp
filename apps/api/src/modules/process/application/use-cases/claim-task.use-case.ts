import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_TASKS_WORK } from '../../contracts/permissions';
import { PROCESS_TASK_CLAIMED } from '../../domain/audit-actions';
import { canClaim } from '../../domain/task-access';
import {
  TASK_NOT_FOUND,
  TASK_UNAVAILABLE,
  type TaskNotFound,
  type TaskUnavailable,
} from '../failures';
import type { ProcessRepository } from '../process.repository';
import { INBOX_KEYS, staffOf, type TaskInbox } from '../task-inbox';

export interface ClaimTaskInput {
  readonly taskId: Id<'ProcessTask'>;
}

/**
 * Takes a task from its queue (owner decision D3): the caller holds the queue's role and the
 * work key at the task's site, and nobody holds the task yet. Two claims at once: the second
 * is a stale write (409 `conflict.stale`).
 */
export class ClaimTask extends UseCase<
  ClaimTaskInput,
  { version: number },
  TaskNotFound | TaskUnavailable
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.claim-task',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_WORK.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly inbox: TaskInbox,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ClaimTaskInput,
  ): Promise<Result<{ version: number }, TaskNotFound | TaskUnavailable>> {
    const actor = staffOf(context);
    const visible = await this.inbox.visibleTask(context, actor, input.taskId);
    if (visible === null) return err(TASK_NOT_FOUND);
    const { task, at } = visible;
    if (!canClaim(task, at, INBOX_KEYS.work, this.inbox.now())) return err(TASK_UNAVAILABLE);
    return this.unitOfWork.run<{ version: number }, never>(context.tenant, async () => {
      // The version read is the one checked: a task changed meanwhile is not claimed.
      if (!(await this.repository.assignTask(context.tenant, task, actor.accountId))) {
        throw new StaleAggregateError('ProcessTask', task.id);
      }
      await this.audit.record(context, PROCESS_TASK_CLAIMED.entry(task.id, {}));
      return ok({ version: task.version + 1 });
    });
  }
}
