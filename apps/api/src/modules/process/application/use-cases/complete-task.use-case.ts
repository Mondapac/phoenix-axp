import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_TASKS_WORK } from '../../contracts/permissions';
import { PROCESS_TASK_COMPLETION_REQUESTED } from '../../domain/audit-actions';
import { canComplete } from '../../domain/task-access';
import { outcomeAccepted } from '../../domain/task-settings';
import type { EngineCommands } from '../engine-commands';
import {
  INVALID_OUTCOME,
  TASK_NOT_FOUND,
  TASK_UNAVAILABLE,
  type InvalidOutcome,
  type TaskNotFound,
  type TaskUnavailable,
} from '../failures';
import { INBOX_KEYS, staffOf, type TaskInbox } from '../task-inbox';

export interface CompleteTaskInput {
  readonly taskId: Id<'ProcessTask'>;
  /** One of the task's outcomes; null for a task that offers none. */
  readonly outcome: string | null;
}

type CompleteFailure = TaskNotFound | TaskUnavailable | InvalidOutcome;

/**
 * Decides a task (ADR-0005 decision 4: completion only through a use case): the caller holds
 * it, or takes it from its queue in the same step. The task moves to `completing` and the relay
 * completes it in the engine with its completion key (PoC 3 R4). After the deadline of a task
 * that escalates, the first queue may not decide it (the deadline wins, PoC 3 R7).
 */
export class CompleteTask extends UseCase<
  CompleteTaskInput,
  { status: 'completing' },
  CompleteFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.complete-task',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_WORK.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly inbox: TaskInbox,
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: EngineCommands,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CompleteTaskInput,
  ): Promise<Result<{ status: 'completing' }, CompleteFailure>> {
    const actor = staffOf(context);
    const visible = await this.inbox.visibleTask(context, actor, input.taskId);
    if (visible === null) return err(TASK_NOT_FOUND);
    const { task, at } = visible;
    if (!canComplete(task, actor.accountId, at, INBOX_KEYS.work, this.inbox.now())) {
      return err(TASK_UNAVAILABLE);
    }
    if (!outcomeAccepted(task.outcomes, input.outcome)) return err(INVALID_OUTCOME);
    return this.unitOfWork.run<{ status: 'completing' }, never>(context.tenant, async () => {
      const requested = await this.commands.completeTask(
        context,
        task,
        {},
        { assigneeAccountId: actor.accountId, outcome: input.outcome },
      );
      if (!requested) throw new StaleAggregateError('ProcessTask', task.id);
      await this.audit.record(context, PROCESS_TASK_COMPLETION_REQUESTED.entry(task.id, {}));
      return ok({ status: 'completing' });
    });
  }
}
