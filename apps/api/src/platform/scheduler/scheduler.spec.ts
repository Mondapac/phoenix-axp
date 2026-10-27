// Ported from Mondapac apps/api/src/platform/scheduler/scheduler.spec.ts, with the demo-fa and
// demo-en tenant fixtures in place of the AU and ZZ Markets.
import { Logger } from '@nestjs/common';
import { isMinted, Temporal } from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator } from '@phoenix/shared-kernel/testing';
import { TEST_TENANT_IDS } from '../../../test/support/test-config';
import type { TenantConfig } from '../tenant-config/tenant-config';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { jobLockKey, type JobLock, type JobLockOutcome } from './job-lock';
import { JobRegistry, type JobContext, type JobDefinition } from './job-registry';
import { Scheduler, UnknownJobError } from './scheduler';

/** One lock shared by the schedulers of a test: the advisory lock without a database. */
class InMemoryJobLock implements JobLock {
  readonly held = new Set<bigint>();
  readonly calls: { key: bigint; maxRunMs: number }[] = [];

  async runExclusive(
    key: bigint,
    maxRunMs: number,
    work: () => Promise<void>,
  ): Promise<JobLockOutcome> {
    this.calls.push({ key, maxRunMs });
    if (this.held.has(key)) return 'skipped';
    this.held.add(key);
    try {
      await work();
      return 'ran';
    } finally {
      this.held.delete(key);
    }
  }
}

const NAME = 'identity.purge-expired';

function setup(
  run: (context: JobContext) => Promise<void>,
  overrides: Partial<JobDefinition> = {},
) {
  const registry = new JobRegistry();
  registry.register('identity', [
    { name: NAME, every: Temporal.Duration.from({ hours: 1 }), run, ...overrides },
  ]);
  const tenants = new TenantRegistry(
    new Map(TEST_TENANT_IDS.map((id) => [id, {} as TenantConfig])),
  );
  const contexts = new TenantContextFactory(tenants);
  const ids = new SequenceIdGenerator(
    new FixedClock(Temporal.Instant.from('2026-10-07T00:00:00Z')),
  );
  const lock = new InMemoryJobLock();
  const scheduler = (jitter = () => 0) =>
    new Scheduler(registry, lock, tenants, contexts, ids, jitter);
  return { lock, scheduler };
}

describe('Scheduler.runJobOnce (platform persistence design 7)', () => {
  let errors: jest.SpyInstance;

  beforeEach(() => {
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it('runs once per hosted tenant, demo-fa and demo-en, each with its own minted context and correlation id', async () => {
    const seen: JobContext[] = [];
    const { scheduler, lock } = setup((context) => {
      seen.push(context);
      return Promise.resolve();
    });

    await expect(scheduler().runJobOnce(NAME)).resolves.toEqual({
      outcome: 'ran',
      failedTenants: [],
    });

    expect(seen.map((context) => context.tenant.tenantId)).toEqual(['demo-fa', 'demo-en']);
    expect(seen.every((context) => isMinted(context.tenant))).toBe(true);
    // A minted CallContext with that tenant's system actor (identity slice 1c; Hassan, 1b I3).
    expect(seen.every((context) => isMinted(context) && isMinted(context.actor))).toBe(true);
    expect(seen.map((context) => context.actor)).toEqual([
      { kind: 'system', tenantId: 'demo-fa' },
      { kind: 'system', tenantId: 'demo-en' },
    ]);
    expect(new Set(seen.map((context) => context.correlationId)).size).toBe(2);
    expect(lock.calls).toEqual([{ key: jobLockKey(NAME), maxRunMs: 60_000 }]);
  });

  it('runs demo-en when demo-fa fails, and logs the failure with job, tenant and correlation id', async () => {
    const seen: string[] = [];
    const { scheduler } = setup((context) => {
      seen.push(context.tenant.tenantId);
      return context.tenant.tenantId === 'demo-fa'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve();
    });

    await expect(scheduler().runJobOnce(NAME)).resolves.toEqual({
      outcome: 'ran',
      failedTenants: ['demo-fa'],
    });

    expect(seen).toEqual(['demo-fa', 'demo-en']);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'job.failed',
        job: NAME,
        tenantId: 'demo-fa',
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      }),
    );
  });

  it('skips the run when another runner holds the lock: two runners, one lock, one run', async () => {
    let release!: () => void;
    let runs = 0;
    const { scheduler } = setup(async () => {
      runs += 1;
      await new Promise<void>((resolve) => (release = resolve));
    });

    const first = scheduler().runJobOnce(NAME);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await scheduler().runJobOnce(NAME);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    release();

    expect(second).toEqual({ outcome: 'skipped' });
    await expect(first).resolves.toMatchObject({ outcome: 'ran' });
    expect(runs).toBe(2); // once per tenant, by the first runner only
  });

  it('passes the declared maxRunMs to the lock', async () => {
    const { scheduler, lock } = setup(() => Promise.resolve(), { maxRunMs: 120_000 });

    await scheduler().runJobOnce(NAME);

    expect(lock.calls[0]?.maxRunMs).toBe(120_000);
  });

  it('refuses an unknown job', async () => {
    const { scheduler } = setup(() => Promise.resolve());

    await expect(scheduler().runJobOnce('identity.unknown')).rejects.toBeInstanceOf(
      UnknownJobError,
    );
  });
});

describe('Scheduler.start and stop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts nothing on construction; ticks first after the jittered part, then every interval', async () => {
    const run = jest.fn(() => Promise.resolve());
    const { scheduler } = setup(run);
    const instance = scheduler(() => 0.25);

    await jest.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(run).not.toHaveBeenCalled();

    instance.start();
    await jest.advanceTimersByTimeAsync(900_000 - 1);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2); // demo-fa and demo-en
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(4);

    await instance.stop(10_000);
    await jest.advanceTimersByTimeAsync(10 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('ticks a job declared runAtStart at once, whatever the jitter, then every interval', async () => {
    const run = jest.fn(() => Promise.resolve());
    const { scheduler } = setup(run, { runAtStart: true });
    const instance = scheduler(() => 0.75);

    instance.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2); // demo-fa and demo-en
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(4);

    await instance.stop(10_000);
  });
});
