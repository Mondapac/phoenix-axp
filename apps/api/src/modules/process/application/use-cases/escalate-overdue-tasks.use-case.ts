import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_TASK_ESCALATED } from '../../domain/audit-actions';
import { deadlinePassed } from '../../domain/task-access';
import type { ProcessRepository, TaskRecord } from '../process.repository';

/** Tasks escalated per pass and tenant; the rest wait for the next pass. */
export const ESCALATION_BATCH = 100;

/**
 * Moves every open task whose deadline passed to its escalation role's queue at the same site
 * (ADR-0025; the review's "the task reaches the manager"), held by nobody. One unit per task,
 * the version checked, so a decision or a claim that won the race stays. A task whose decision
 * is on its way to the engine is left to the relay, which lets the deadline win. `system`:
 * called by the `process.escalate-overdue-tasks` job only.
 */
export class EscalateOverdueTasks extends UseCase<void, { escalated: number }> {
  static override readonly access: AccessDeclaration = {
    name: 'process.escalate-overdue-tasks',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<{ escalated: number }, never>> {
    const { tenant } = context;
    const due = await this.unitOfWork.run<TaskRecord[], never>(
      tenant,
      async () =>
        ok(await this.repository.tasksToEscalate(tenant, this.clock.now(), ESCALATION_BATCH)),
      { readOnly: true },
    );
    if (!due.ok) return ok({ escalated: 0 });
    let escalated = 0;
    for (const task of due.value) {
      const moved = await this.unitOfWork.run<boolean, never>(tenant, async () => {
        const now = this.clock.now();
        const fresh = await this.repository.findTask(tenant, task.id);
        if (
          fresh === null ||
          fresh.status !== 'open' ||
          fresh.escalationRoleId === null ||
          !deadlinePassed(fresh, now) ||
          !(await this.repository.escalateTask(tenant, fresh, now))
        ) {
          return ok(false);
        }
        await this.audit.record(
          context,
          PROCESS_TASK_ESCALATED.entry(fresh.id, { after: { role: fresh.escalationRoleId } }),
        );
        return ok(true);
      });
      if (moved.ok && moved.value) escalated += 1;
    }
    return ok({ escalated });
  }
}
