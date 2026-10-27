import { createHmac, hkdfSync } from 'node:crypto';
import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { Clock, Result, TenantContext } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../unit-of-work/unit-of-work';

// Rate limits (ADR-0010 `rate-limit`; trigger: the first public unauthenticated write, form
// submission in slice 2.5). Fixed windows counted in PostgreSQL, so an offline install needs
// nothing more than the database (docs/platform-deferred.md: a Valkey adapter can replace the
// store behind the same port when the load needs it).

/**
 * One limit: at most `limit` hits per `windowSeconds` for one subject. `name` is
 * `<module>.<what>`; it is part of the bucket, so two rules never share a counter.
 */
export interface RateLimitRule {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/** The refusal: answers 429 with `Retry-After`. Names no subject. */
export interface RateLimited {
  readonly code: 'rate-limit.exceeded';
  readonly retryAfterSeconds: number;
}
export const RATE_LIMITED_STATUS: Readonly<Record<RateLimited['code'], number>> = Object.freeze({
  'rate-limit.exceeded': 429,
});

/**
 * Counts a hit of `subject` (a client address, an account id) against `rule` in its own unit
 * of work: call it before the use case's unit, never inside one. The subject is stored only as
 * an HMAC.
 */
export interface RateLimiter {
  consume(
    tenant: TenantContext,
    rule: RateLimitRule,
    subject: string,
  ): Promise<Result<void, RateLimited>>;
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** The windows in `platform.rate_limit_window` (implemented in platform/persistence/). */
export interface RateLimitStore {
  /** Adds one hit when the window holds fewer than `limit`; false when it is full or absent. */
  increment(
    tenant: TenantContext,
    bucket: string,
    windowStart: Temporal.Instant,
    limit: number,
  ): Promise<boolean>;
  /** True when the window exists (it is then full: {@link increment} answered false). */
  exists(tenant: TenantContext, bucket: string, windowStart: Temporal.Instant): Promise<boolean>;
  /** Opens a window with one hit; throws on a concurrent insert of the same window. */
  open(tenant: TenantContext, bucket: string, windowStart: Temporal.Instant): Promise<void>;
  /** Deletes the windows that started before `before`; returns how many. */
  prune(tenant: TenantContext, before: Temporal.Instant): Promise<number>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/** The longest window a rule may use: one day, the age at which windows are pruned. */
export const MAX_WINDOW_SECONDS = 86_400;

export function checkRule(rule: RateLimitRule): void {
  if (
    !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(rule.name) ||
    !Number.isInteger(rule.limit) ||
    rule.limit < 1 ||
    !Number.isInteger(rule.windowSeconds) ||
    rule.windowSeconds < 1 ||
    rule.windowSeconds > MAX_WINDOW_SECONDS
  ) {
    throw new TypeError(`Invalid rate-limit rule "${rule.name}"`);
  }
}

/** The bucket key derived from the deployment's session secret: never the secret itself. */
export function rateLimitKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'phoenix:rate-limit:v1', 32));
}

type Outcome = 'allowed' | 'full' | 'race';

/** The PostgreSQL rate limiter: one short read-write unit per hit. */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: RateLimitStore,
    private readonly clock: Clock,
    private readonly key: Buffer,
  ) {}

  async consume(
    tenant: TenantContext,
    rule: RateLimitRule,
    subject: string,
  ): Promise<Result<void, RateLimited>> {
    checkRule(rule);
    const bucket = createHmac('sha256', this.key).update(`${rule.name}\n${subject}`).digest('hex');
    const now = this.clock.now();
    const windowMs = rule.windowSeconds * 1000;
    const startMs = Math.floor(now.epochMilliseconds / windowMs) * windowMs;
    const windowStart = Temporal.Instant.fromEpochMilliseconds(startMs);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((startMs + windowMs - now.epochMilliseconds) / 1000),
    );

    // Two attempts: a concurrent first hit of the same window makes the insert fail (and the
    // unit roll back); the second attempt then finds the window and counts in it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await this.attempt(tenant, bucket, windowStart, rule.limit);
      if (outcome === 'allowed') return ok(undefined);
      if (outcome === 'full') return err({ code: 'rate-limit.exceeded', retryAfterSeconds });
    }
    return err({ code: 'rate-limit.exceeded', retryAfterSeconds });
  }

  private async attempt(
    tenant: TenantContext,
    bucket: string,
    windowStart: Temporal.Instant,
    limit: number,
  ): Promise<Outcome> {
    try {
      const result = await this.unitOfWork.run<Outcome, never>(tenant, async () => {
        if (await this.store.increment(tenant, bucket, windowStart, limit)) return ok('allowed');
        if (await this.store.exists(tenant, bucket, windowStart)) return ok('full');
        await this.store.open(tenant, bucket, windowStart);
        return ok('allowed');
      });
      return result.ok ? result.value : 'full';
    } catch (error) {
      if (error instanceof WindowRaceError) return 'race';
      throw error;
    }
  }
}

/** Thrown by a store when another request opened the same window first. */
export class WindowRaceError extends Error {
  override readonly name = 'WindowRaceError';
  constructor() {
    super('A rate-limit window was opened concurrently');
  }
}
