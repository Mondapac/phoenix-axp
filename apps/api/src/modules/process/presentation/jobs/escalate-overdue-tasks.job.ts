import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { EscalateOverdueTasks } from '../../application/use-cases/escalate-overdue-tasks.use-case';

/**
 * `process.escalate-overdue-tasks` (ADR-0025): every 30 seconds, for each hosted tenant, moves
 * the open tasks whose deadline passed to their escalation queue. Safe to overlap: each move is
 * a version-checked write.
 */
export function escalateOverdueTasksJob(escalate: EscalateOverdueTasks): JobDefinition {
  return {
    name: 'process.escalate-overdue-tasks',
    every: Temporal.Duration.from({ seconds: 30 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await escalate.execute(context, undefined);
      if (!result.ok) throw new Error(`process.escalate-overdue-tasks: ${result.error.code}`);
    },
  };
}
