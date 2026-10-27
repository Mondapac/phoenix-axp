import { Global, Module } from '@nestjs/common';
import { ok, Temporal } from '@phoenix/shared-kernel';
import type { Clock } from '@phoenix/shared-kernel';
import { CLOCK } from '../clock/clock.module';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { registerJobsFrom, type JobDefinition } from '../scheduler/job-registry';
import { UNIT_OF_WORK, type UnitOfWork } from '../unit-of-work/unit-of-work';
import {
  CAPTCHA_SERVICE,
  CAPTCHA_SPENT_STORE,
  CaptchaService,
  type CaptchaSpentStore,
} from './proof-of-work';

/** `platform.captcha-prune`: every 10 minutes, the spent challenges that have expired. */
export const CAPTCHA_PRUNE_JOB = 'platform.captcha-prune';

function pruneJob(unitOfWork: UnitOfWork, store: CaptchaSpentStore, clock: Clock): JobDefinition {
  return {
    name: CAPTCHA_PRUNE_JOB,
    every: Temporal.Duration.from({ minutes: 10 }),
    async run(context): Promise<void> {
      const now = clock.now();
      await unitOfWork.run(context.tenant, async () => ok(await store.prune(context.tenant, now)));
    },
  };
}

/**
 * The self-hosted proof-of-work CAPTCHA. Global; exports `CAPTCHA_SERVICE` only. Its signing
 * key is derived from `SESSION_SECRET`, so every process of a deployment accepts the
 * challenges of the others.
 */
@Global()
@Module({
  providers: [
    {
      provide: CAPTCHA_SERVICE,
      inject: [APP_CONFIG, UNIT_OF_WORK, CAPTCHA_SPENT_STORE, CLOCK],
      useFactory: (
        config: AppConfig,
        unitOfWork: UnitOfWork,
        store: CaptchaSpentStore,
        clock: Clock,
      ) => new CaptchaService(config.session.secret, unitOfWork, store, clock),
    },
    registerJobsFrom(
      'platform',
      [UNIT_OF_WORK, CAPTCHA_SPENT_STORE, CLOCK],
      (unitOfWork: UnitOfWork, store: CaptchaSpentStore, clock: Clock) => [
        pruneJob(unitOfWork, store, clock),
      ],
    ),
  ],
  exports: [CAPTCHA_SERVICE],
})
export class CaptchaModule {}
