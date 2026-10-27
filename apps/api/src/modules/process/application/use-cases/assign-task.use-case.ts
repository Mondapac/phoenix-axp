import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_TASKS_ASSIGN } from '../../contracts/permissions';
import { PROCESS_TASK_ASSIGNED } from '../../domain/audit-actions';
import { canAssign, deadlinePassed, eligibleAssignee } from '../../domain/task-access';
import {
  INELIGIBLE_ASSIGNEE,
  TASK_NOT_FOUND,
  TASK_UNAVAILABLE,
  type IneligibleAssignee,
  type TaskNotFound,
  type TaskUnavailable,
} from '../failures';
import type { ProcessRepository } from '../process.repository';
import { INBOX_KEYS, staffOf, type TaskInbox } from '../task-inbox';

export interface AssignTaskInput {
  readonly taskId: Id<'ProcessTask'>;
  readonly accountId: Id<'Account'>;
}

type AssignFailure = TaskNotFound | TaskUnavailable | IneligibleAssignee;

/**
 * A supervisor gives an open task to a person (ADR-0025): the caller holds the assign key at
 * the task's site; the person is an active account holding the work key there and, for a
 * queued task, the queue's role. Both are read from identity, never from input.
 */
export class AssignTask extends UseCase<AssignTaskInput, { version: number }, AssignFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'process.assign-task',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_ASSIGN.key] },
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
    input: AssignTaskInput,
  ): Promise<Result<{ version: number }, AssignFailure>> {
    const actor = staffOf(context);
    const visible = await this.inbox.visibleTask(context, actor, input.taskId);
    if (visible === null || !canAssign(visible.at, INBOX_KEYS.assign)) {
      return err(TASK_NOT_FOUND);
    }
    const { task } = visible;
    if (task.status !== 'open' || deadlinePassed(task, this.inbox.now())) {
      return err(TASK_UNAVAILABLE);
    }
    const assignee = await this.inbox.holdingsOf(context, input.accountId);
    if (!eligibleAssignee(task, await assignee.at(task.siteId), INBOX_KEYS.work)) {
      return err(INELIGIBLE_ASSIGNEE);
    }
    return this.unitOfWork.run<{ version: number }, never>(context.tenant, async () => {
      if (!(await this.repository.assignTask(context.tenant, task, input.accountId))) {
        throw new StaleAggregateError('ProcessTask', task.id);
      }
      await this.audit.record(
        context,
        PROCESS_TASK_ASSIGNED.entry(task.id, { after: { assignee: input.accountId } }),
      );
      return ok({ version: task.version + 1 });
    });
  }
}
