import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_TASKS_WORK } from '../../contracts/permissions';
import { PROCESS_TASK_RELEASED } from '../../domain/audit-actions';
import { canRelease } from '../../domain/task-access';
import {
  TASK_NOT_FOUND,
  TASK_UNAVAILABLE,
  type TaskNotFound,
  type TaskUnavailable,
} from '../failures';
import type { ProcessRepository } from '../process.repository';
import { staffOf, type TaskInbox } from '../task-inbox';

export interface ReleaseTaskInput {
  readonly taskId: Id<'ProcessTask'>;
}

/** Gives a claimed task back to its queue; a task sent straight to the caller stays with it. */
export class ReleaseTask extends UseCase<
  ReleaseTaskInput,
  { version: number },
  TaskNotFound | TaskUnavailable
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.release-task',
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
    input: ReleaseTaskInput,
  ): Promise<Result<{ version: number }, TaskNotFound | TaskUnavailable>> {
    const actor = staffOf(context);
    const visible = await this.inbox.visibleTask(context, actor, input.taskId);
    if (visible === null) return err(TASK_NOT_FOUND);
    const { task } = visible;
    if (!canRelease(task, actor.accountId)) return err(TASK_UNAVAILABLE);
    return this.unitOfWork.run<{ version: number }, never>(context.tenant, async () => {
      if (!(await this.repository.assignTask(context.tenant, task, null))) {
        throw new StaleAggregateError('ProcessTask', task.id);
      }
      await this.audit.record(context, PROCESS_TASK_RELEASED.entry(task.id, {}));
      return ok({ version: task.version + 1 });
    });
  }
}
