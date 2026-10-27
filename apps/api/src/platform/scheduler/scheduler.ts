// Ported from Mondapac apps/api/src/platform/scheduler/scheduler.ts, Market adapted to Tenant:
// every run is one hosted tenant's, as that tenant's system actor.
import { Logger } from '@nestjs/common';
import { parseCorrelationId } from '@phoenix/shared-kernel';
import type { IdGenerator } from '@phoenix/shared-kernel';
import { createCallContext, systemActor } from '@phoenix/shared-kernel/contexts';
import type { TenantRegistry } from '../tenant-config/tenant-registry';
import type { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { jobLockKey, type JobLock, type JobLockOutcome } from './job-lock';
import {
  DEFAULT_MAX_RUN_MS,
  intervalMsOf,
  type JobContext,
  type JobDefinition,
  type JobRegistry,
} from './job-registry';

/** Unknown job name given to {@link Scheduler.runJobOnce}. */
export class UnknownJobError extends Error {
  override readonly name = 'UnknownJobError';
  constructor() {
    super('No job of that name is registered');
  }
}

/** What one run did: skipped when another runner held the lock, else the tenants that failed. */
export type JobRunResult =
  { readonly outcome: 'skipped' } | { readonly outcome: 'ran'; readonly failedTenants: string[] };

/** Where the first tick of a job falls inside its interval: a fraction from 0 to 1. */
export type Jitter = () => number;

/**
 * The scheduler runner of platform persistence design, "P", 7, for the `worker` role. Each job
 * ticks every `every`, the first time after a random part of the interval, or at once for a
 * job declared `runAtStart`. A run takes the
 * job's lock (one runner across processes, skipped when taken) and then, for each hosted
 * tenant in turn: the tenant's context from the factory, a newly generated correlation id, and
 * `run(context)`. One tenant's failure is logged with job, tenant and correlation id, and the
 * next tenant still runs (foundations 5.1). No schedule state is stored.
 *
 * Nothing starts on construction: `WorkerRuntime.start()` calls {@link start}, and tests call
 * {@link runJobOnce} themselves (P 8).
 */
export class Scheduler {
  private readonly logger = new Logger('Scheduler');
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private stopping = false;

  constructor(
    private readonly registry: JobRegistry,
    private readonly lock: JobLock,
    private readonly tenants: TenantRegistry,
    private readonly contexts: TenantContextFactory,
    private readonly ids: IdGenerator,
    private readonly jitter: Jitter = Math.random,
  ) {}

  async runJobOnce(name: string): Promise<JobRunResult> {
    const job = this.registry.get(name);
    if (job === undefined) throw new UnknownJobError();
    const failedTenants: string[] = [];
    const outcome: JobLockOutcome = await this.lock.runExclusive(
      jobLockKey(job.name),
      job.maxRunMs ?? DEFAULT_MAX_RUN_MS,
      async () => {
        for (const tenantId of this.tenants.hostedTenantIds()) {
          if (!(await this.runForTenant(job, tenantId))) failedTenants.push(tenantId);
        }
      },
    );
    return outcome === 'skipped' ? { outcome } : { outcome, failedTenants };
  }

  private async runForTenant(job: JobDefinition, tenantId: string): Promise<boolean> {
    const tenant = this.contexts.forTenant(tenantId);
    const correlationId = parseCorrelationId(this.ids.next<'job-run'>());
    if (!tenant.ok || !correlationId.ok) {
      this.logger.error({ msg: 'job.tenant-skipped', job: job.name, tenantId });
      return false;
    }
    try {
      // The job's CallContext: this tenant's system actor (foundations 5.1; P 7).
      const context: JobContext = createCallContext(
        tenant.value,
        systemActor(tenant.value),
        correlationId.value,
      );
      await job.run(context);
      return true;
    } catch (error) {
      this.logger.error({
        msg: 'job.failed',
        job: job.name,
        tenantId,
        correlationId: correlationId.value,
        err: error,
      });
      return false;
    }
  }

  /** Starts a timer per registered job. Called by `WorkerRuntime.start()` only. */
  start(): void {
    this.stopping = false;
    for (const name of this.registry.names()) {
      const job = this.registry.get(name)!;
      const interval = intervalMsOf(job);
      const first = setTimeout(
        () => {
          this.timers.delete(first);
          this.tick(name);
          const every = setInterval(() => this.tick(name), interval);
          this.timers.add(every);
        },
        job.runAtStart === true ? 0 : Math.floor(this.jitter() * interval),
      );
      this.timers.add(first);
    }
  }

  private tick(name: string): void {
    if (this.stopping) return;
    const run = this.runJobOnce(name)
      .then((result) => {
        if (result.outcome === 'skipped') {
          this.logger.debug({ msg: 'job.skipped', job: name });
        }
      })
      .catch((error: unknown) => {
        // The lock transaction failed or ended at maxRunMs; the next tick picks the work up.
        this.logger.error({ msg: 'job.run-failed', job: name, err: error });
      })
      .finally(() => this.inFlight.delete(run));
    this.inFlight.add(run);
  }

  /** No new tick; waits up to `graceMs` for the runs in flight (P 8). */
  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    let timeout: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, graceMs);
    });
    await Promise.race([Promise.allSettled([...this.inFlight]), grace]);
    clearTimeout(timeout);
  }
}
