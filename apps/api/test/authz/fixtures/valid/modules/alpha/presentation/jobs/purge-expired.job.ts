// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/presentation/jobs/purge-expired.job.ts.
import { Temporal, type JobDefinition } from '../../../../../platform';

/** A job definition in presentation/jobs/: allowed (L2). */
export const PURGE_EXPIRED_JOB: JobDefinition = {
  name: 'alpha.purge-expired',
  every: Temporal.Duration.from({ hours: 1 }),
  run: () => Promise.resolve(),
};
