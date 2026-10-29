import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { PrunePortalCodes } from '../../application/use-cases/prune-portal-codes.use-case';

/** `identity.prune-portal-codes`: every hour, for each hosted tenant (ADR-0026 decision 3). */
export function prunePortalCodesJob(prune: PrunePortalCodes): JobDefinition {
  return {
    name: 'identity.prune-portal-codes',
    every: Temporal.Duration.from({ hours: 1 }),
    async run(context: JobContext): Promise<void> {
      const result = await prune.execute(context, undefined);
      if (!result.ok) throw new Error('identity.prune-portal-codes failed');
    },
  };
}
