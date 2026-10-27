// Ported from Mondapac apps/api/test/authz/fixtures/valid/modules/alpha/alpha.module.ts.
import { registerJobs } from '../../../platform';
import { PURGE_EXPIRED_JOB } from './presentation/jobs/purge-expired.job';

/** The Nest module registers a job declared in presentation/jobs/: allowed (L2). */
export const ALPHA_JOBS = registerJobs('alpha', [PURGE_EXPIRED_JOB]);
