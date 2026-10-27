import { randomBytes } from 'node:crypto';
import { ok, Temporal } from '@phoenix/shared-kernel';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { FixedClock, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import type { UnitOfWork } from '../unit-of-work/unit-of-work';
import { PostgresRateLimiter, WindowRaceError, type RateLimitStore } from './rate-limiter';

// Fixed-window rate limits: `limit` hits per window and subject, counted per tenant; the
// subject is stored only as an HMAC.

const unit = {
  run: <T, E>(_tenant: TenantContext, work: () => Promise<Result<T, E>>) => work(),
} as unknown as UnitOfWork;

class MemoryWindows implements RateLimitStore {
  readonly hits = new Map<string, number>();
  raceOnce = false;
  key = (tenant: TenantContext, bucket: string, start: Temporal.Instant) =>
    `${tenant.tenantId}/${bucket}/${start.epochMilliseconds}`;
  increment(tenant: TenantContext, bucket: string, start: Temporal.Instant, limit: number) {
    const key = this.key(tenant, bucket, start);
    const hits = this.hits.get(key);
    if (hits === undefined || hits >= limit) return Promise.resolve(false);
    this.hits.set(key, hits + 1);
    return Promise.resolve(true);
  }
  exists(tenant: TenantContext, bucket: string, start: Temporal.Instant) {
    return Promise.resolve(this.hits.has(this.key(tenant, bucket, start)));
  }
  open(tenant: TenantContext, bucket: string, start: Temporal.Instant) {
    if (this.raceOnce) {
      // Another request opened the window first.
      this.raceOnce = false;
      this.hits.set(this.key(tenant, bucket, start), 1);
      return Promise.reject(new WindowRaceError());
    }
    this.hits.set(this.key(tenant, bucket, start), 1);
    return Promise.resolve();
  }
  prune() {
    return Promise.resolve(0);
  }
}

describe.each(TEST_TENANTS)('the rate limiter in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const other = testTenantContext(TEST_TENANTS.find((c) => c !== code)!);
  const rule = { name: 'forms.test', limit: 2, windowSeconds: 60 };

  it('allows `limit` hits per window and subject, then refuses with the time to wait', async () => {
    const clock = new FixedClock(Temporal.Instant.from('2026-10-27T20:00:10Z'));
    const store = new MemoryWindows();
    const limiter = new PostgresRateLimiter(unit, store, clock, randomBytes(32));
    await expect(limiter.consume(tenant, rule, 'address:1')).resolves.toEqual(ok(undefined));
    await expect(limiter.consume(tenant, rule, 'address:1')).resolves.toEqual(ok(undefined));
    await expect(limiter.consume(tenant, rule, 'address:1')).resolves.toEqual({
      ok: false,
      error: { code: 'rate-limit.exceeded', retryAfterSeconds: 50 },
    });
    // Another subject and another tenant count separately; no subject is stored in clear.
    await expect(limiter.consume(tenant, rule, 'address:2')).resolves.toEqual(ok(undefined));
    await expect(limiter.consume(other, rule, 'address:1')).resolves.toEqual(ok(undefined));
    expect([...store.hits.keys()].some((key) => key.includes('address'))).toBe(false);
    // The next window starts afresh.
    clock.advance(Temporal.Duration.from({ seconds: 50 }));
    await expect(limiter.consume(tenant, rule, 'address:1')).resolves.toEqual(ok(undefined));
  });

  it('counts in a window another request opened at the same moment', async () => {
    const clock = new FixedClock(Temporal.Instant.from('2026-10-27T20:00:00Z'));
    const store = new MemoryWindows();
    store.raceOnce = true;
    const limiter = new PostgresRateLimiter(unit, store, clock, randomBytes(32));
    await expect(limiter.consume(tenant, rule, 'address:1')).resolves.toEqual(ok(undefined));
    expect([...store.hits.values()]).toEqual([2]);
  });

  it('refuses an invalid rule', async () => {
    const limiter = new PostgresRateLimiter(
      unit,
      new MemoryWindows(),
      new FixedClock(Temporal.Instant.from('2026-10-27T20:00:00Z')),
      randomBytes(32),
    );
    await expect(
      limiter.consume(tenant, { name: 'x', limit: 0, windowSeconds: 0 }, 's'),
    ).rejects.toThrow(TypeError);
  });
});
