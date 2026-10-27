// Ported from Mondapac apps/api/src/platform/scheduler/scheduler.module.ts, Market adapted to Tenant.
import { Global, Module } from '@nestjs/common';
import type { IdGenerator } from '@phoenix/shared-kernel';
import { ID_GENERATOR } from '../ids/ids.module';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { JOB_LOCK, type JobLock } from './job-lock';
import { JobRegistry } from './job-registry';
import { Scheduler } from './scheduler';

/**
 * The scheduler (platform persistence design, "P", 7): the job registry modules register
 * with, and the runner the worker starts. The lock is bound by the persistence module.
 */
@Global()
@Module({
  providers: [
    JobRegistry,
    {
      provide: Scheduler,
      inject: [JobRegistry, JOB_LOCK, TenantRegistry, TenantContextFactory, ID_GENERATOR],
      useFactory: (
        registry: JobRegistry,
        lock: JobLock,
        tenants: TenantRegistry,
        contexts: TenantContextFactory,
        ids: IdGenerator,
      ) => new Scheduler(registry, lock, tenants, contexts, ids),
    },
  ],
  exports: [JobRegistry, Scheduler],
})
export class SchedulerModule {}
