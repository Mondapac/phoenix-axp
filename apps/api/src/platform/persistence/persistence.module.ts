import { Global, Module } from '@nestjs/common';
import { MODEL_MAP } from '../../generated/model-map';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { UNIT_OF_WORK } from '../unit-of-work/unit-of-work';
import { DatabaseProbe } from './database-probe';
import { createGuardedClient, GUARDED_CLIENT, type GuardedClient } from './guarded-client';
import type { ModelMap } from './model-map';
import { PrismaRoot } from './prisma-root';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

/** The generated map, checked against the shape the guard reads. */
const modelMap: ModelMap = MODEL_MAP;

/**
 * Persistence (ported from Mondapac's platform persistence design, "P", 3.3). Exports the
 * guarded door for modules (`PrismaService`), the `UnitOfWork` port and `DatabaseProbe`; never
 * the base client (`PrismaRoot`) or the guarded client, so Nest cannot inject them elsewhere.
 * The outbox, audit, raw-read, job-lock and rate-limit bindings of Mondapac are deferred
 * (docs/platform-deferred.md).
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaRoot,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new PrismaRoot(config),
    },
    {
      provide: GUARDED_CLIENT,
      inject: [PrismaRoot],
      useFactory: (root: PrismaRoot) => createGuardedClient(root, modelMap),
    },
    PrismaService,
    {
      provide: UNIT_OF_WORK,
      inject: [GUARDED_CLIENT],
      useFactory: (client: GuardedClient) => new PrismaUnitOfWork(client, modelMap),
    },
    {
      provide: DatabaseProbe,
      inject: [PrismaRoot],
      useFactory: (root: PrismaRoot) => new DatabaseProbe(root),
    },
  ],
  exports: [PrismaService, UNIT_OF_WORK, DatabaseProbe],
})
export class PersistenceModule {}
