import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import { PROCESS_TASKS_WORK } from '../../contracts/permissions';
import { TASK_NOT_FOUND, type TaskNotFound } from '../failures';
import { inboxTaskOf, staffOf, type InboxTask, type TaskInbox } from '../task-inbox';

/** The shape the inbox answers, for the controller (it reaches application/ through use cases). */
export type { InboxTask };

export interface ViewTaskInput {
  readonly taskId: Id<'ProcessTask'>;
}

/**
 * One task of the inbox, for a person who holds it, may claim it from a queue or supervises
 * its site; any other answers "not found". No form data: the task form arrives with the form
 * link (slice 2.6), read through the FieldPolicy (ADR-0024).
 */
export class ViewTask extends UseCase<ViewTaskInput, InboxTask, TaskNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'process.view-task',
    rule: { kind: 'permissions', allOf: [PROCESS_TASKS_WORK.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly inbox: TaskInbox,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: ViewTaskInput,
  ): Promise<Result<InboxTask, TaskNotFound>> {
    const visible = await this.inbox.visibleTask(context, staffOf(context), input.taskId);
    if (visible === null) return err(TASK_NOT_FOUND);
    return ok(inboxTaskOf(visible.task, this.inbox.now()));
  }
}
