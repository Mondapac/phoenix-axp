import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { SyncDirectoryAccounts } from '../../application/use-cases/sync-directory-accounts.use-case';

/**
 * `identity.sync-directory-accounts` (ADR-0022 decision 6): every minute, for each hosted
 * tenant, the use case runs that tenant's sync when its own interval (1 to 60 minutes, 5 by
 * default) has passed. One minute is therefore the finest interval a tenant can set.
 */
export function syncDirectoryAccountsJob(sync: SyncDirectoryAccounts): JobDefinition {
  return {
    name: 'identity.sync-directory-accounts',
    every: Temporal.Duration.from({ minutes: 1 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await sync.execute(context, undefined);
      if (!result.ok) throw new Error(`identity.sync-directory-accounts: ${result.error.code}`);
    },
  };
}
