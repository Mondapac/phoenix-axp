import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { SealRecords } from '../../application/use-cases/seal-records.use-case';

/**
 * `objects.seal-records` (ADR-0017 decision 4): every 15 minutes, for each hosted tenant, seals
 * the values of fields marked sensitive after records were written under an earlier revision.
 */
export function sealRecordsJob(seal: SealRecords): JobDefinition {
  return {
    name: 'objects.seal-records',
    every: Temporal.Duration.from({ minutes: 15 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await seal.execute(context, undefined);
      if (!result.ok) throw new Error('objects.seal-records: refused');
    },
  };
}
