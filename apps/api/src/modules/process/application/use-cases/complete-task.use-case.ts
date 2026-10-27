import { encodePayload, err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { taskCompletionRequested } from '../../domain/events';
import { checkCompletion, isDecision, type CompletionRefusal } from '../../domain/task';
import type { ProcessStore } from '../ports/process-store';

export interface CompleteTaskInput {
  readonly taskId: string;
  readonly decision: unknown;
}

export type CompleteTaskError =
  | { readonly code: 'task.forbidden' }
  | { readonly code: 'task.invalid-decision' }
  | { readonly code: CompletionRefusal }
  | { readonly code: 'task.conflict' };

const NO_PERMISSION_KEYS = { isKnownPermissionKey: () => false };

/**
 * The only way a task is completed (ADR-0005 decision 4): the core authorises the actor, then
 * records the decision and the completion command in one transaction. The task moves to
 * `completing`; the relay completes it in the engine with the outbox event id as its
 * completion key, and the task becomes `completed` (or `superseded` when the deadline won).
 *
 * Access (spike): the task's assignee, in the task's tenant. Anyone else gets `task.not-found`.
 */
export class CompleteTask {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: ProcessStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    context: CallContext,
    input: CompleteTaskInput,
  ): Promise<Result<void, CompleteTaskError>> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return err({ code: 'task.forbidden' });
    if (!isDecision(input.decision)) return err({ code: 'task.invalid-decision' });
    const decision = input.decision;

    return this.unitOfWork.run(tenant, async (): Promise<Result<void, CompleteTaskError>> => {
      const task = await this.store.findTask(tenant, input.taskId);
      if (task === null) return err({ code: 'task.not-found' as const });
      const refusal = checkCompletion(task, actor.accountId);
      if (refusal !== null) return err({ code: refusal });

      const completionKey = this.ids.next<'event'>();
      const now = this.clock.now();
      const updated = await this.store.updateTask(tenant, task.id, task.version, {
        status: 'completing',
        decision,
        completionKey,
      });
      if (!updated) return err({ code: 'task.conflict' as const });
      const event = taskCompletionRequested.record({
        aggregateId: task.id,
        aggregateVersion: task.version + 1,
        occurredAt: now,
        payload: { taskId: task.id, decision },
      });
      const payload = encodePayload(
        taskCompletionRequested.fields,
        event.payload,
        NO_PERMISSION_KEYS,
      );
      if (!payload.ok) throw new Error('process.task-completion-requested.v1: payload refused');
      await this.store.appendOutbox(tenant, {
        eventId: completionKey,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: task.id,
        aggregateVersion: task.version + 1,
        occurredAt: now,
        correlationId: context.correlationId,
        payload: payload.value,
      });
      return ok(undefined);
    });
  }
}
