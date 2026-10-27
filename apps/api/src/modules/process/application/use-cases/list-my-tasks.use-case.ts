import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OPEN_STATUSES } from '../../domain/task';
import type { ProcessStore, TaskRecord } from '../ports/process-store';

/**
 * The Task Inbox: the actor's own open tasks (and those whose decision is on its way to the
 * engine), in the actor's tenant only. The engine is never asked: the inbox is the core's.
 */
export class ListMyTasks {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: ProcessStore,
  ) {}

  async execute(
    context: CallContext,
  ): Promise<Result<readonly TaskRecord[], { readonly code: 'task.forbidden' }>> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return err({ code: 'task.forbidden' });
    return this.unitOfWork.run(
      tenant,
      async () =>
        ok(
          await this.store.tasks(tenant, { statuses: OPEN_STATUSES, assigneeId: actor.accountId }),
        ),
      { readOnly: true },
    );
  }
}
