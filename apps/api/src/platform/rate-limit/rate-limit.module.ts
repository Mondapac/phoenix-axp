import { Global, Module } from '@nestjs/common';
import { ok, Temporal } from '@phoenix/shared-kernel';
import type { Clock } from '@phoenix/shared-kernel';
import { CLOCK } from '../clock/clock.module';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { registerJobsFrom, type JobContext, type JobDefinition } from '../scheduler/job-registry';
import { UNIT_OF_WORK, type UnitOfWork } from '../unit-of-work/unit-of-work';
import {
  MAX_WINDOW_SECONDS,
  PostgresRateLimiter,
  RATE_LIMIT_STORE,
  RATE_LIMITER,
  rateLimitKey,
  type RateLimitStore,
} from './rate-limiter';

/** `platform.rate-limit-prune`: every 10 minutes, the windows older than the longest window. */
export const RATE_LIMIT_PRUNE_JOB = 'platform.rate-limit-prune';

function pruneJob(unitOfWork: UnitOfWork, store: RateLimitStore, clock: Clock): JobDefinition {
  return {
    name: RATE_LIMIT_PRUNE_JOB,
    every: Temporal.Duration.from({ minutes: 10 }),
    async run(context: JobContext): Promise<void> {
      const before = clock.now().subtract({ seconds: MAX_WINDOW_SECONDS });
      await unitOfWork.run(context.tenant, async () =>
        ok(await store.prune(context.tenant, before)),
      );
    },
  };
}

/**
 * Rate limits (ADR-0010) on PostgreSQL. Global; exports `RATE_LIMITER` only. The bucket key
 * is derived from `SESSION_SECRET`.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      inject: [UNIT_OF_WORK, RATE_LIMIT_STORE, CLOCK, APP_CONFIG],
      useFactory: (
        unitOfWork: UnitOfWork,
        store: RateLimitStore,
        clock: Clock,
        config: AppConfig,
      ) => new PostgresRateLimiter(unitOfWork, store, clock, rateLimitKey(config.session.secret)),
    },
    registerJobsFrom(
      'platform',
      [UNIT_OF_WORK, RATE_LIMIT_STORE, CLOCK],
      (unitOfWork: UnitOfWork, store: RateLimitStore, clock: Clock) => [
        pruneJob(unitOfWork, store, clock),
      ],
    ),
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
