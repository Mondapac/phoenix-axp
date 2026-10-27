import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { SyncEngine } from '../../application/use-cases/sync-engine.use-case';

/**
 * `process.sync-engine` (PoC 3 R5): every 5 seconds, for each hosted tenant, one pass that
 * reads the engine's open tasks and what ended since the watermarks. Safe to overlap: every
 * observation is applied once through the observation inbox.
 */
export function syncEngineJob(sync: SyncEngine): JobDefinition {
  return {
    name: 'process.sync-engine',
    every: Temporal.Duration.from({ seconds: 5 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await sync.execute(context, undefined);
      if (!result.ok) throw new Error(`process.sync-engine: ${result.error.code}`);
    },
  };
}
