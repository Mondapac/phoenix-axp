import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { EraseExpiredSubmissions } from '../../application/use-cases/erase-expired-submissions.use-case';

/**
 * `forms.erase-expired-submissions` (owner decision D5): every 15 minutes, for each hosted
 * tenant, destroys the subject keys of the submissions whose retention has ended.
 */
export function eraseExpiredSubmissionsJob(erase: EraseExpiredSubmissions): JobDefinition {
  return {
    name: 'forms.erase-expired-submissions',
    every: Temporal.Duration.from({ minutes: 15 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await erase.execute(context, undefined);
      if (!result.ok) throw new Error('forms.erase-expired-submissions: refused');
    },
  };
}
