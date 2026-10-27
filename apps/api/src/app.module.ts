import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { DestinationStream } from 'pino';
import { ActorGuard } from './platform/call-context/actor.guard';
import { ClockModule } from './platform/clock/clock.module';
import type { AppConfig } from './platform/config/app-config';
import { ConfigModule } from './platform/config/config.module';
import { HealthModule } from './platform/health/health.module';
import { ConflictFilter } from './platform/http/conflict-filter';
import { IdsModule } from './platform/ids/ids.module';
import { LoggingModule } from './platform/logging/logging.module';
import { PersistenceModule } from './platform/persistence/persistence.module';
import { StorageModule } from './platform/storage/storage.module';
import { TenantConfigModule } from './platform/tenant-config/tenant-config.module';
import { TenantContextGuard } from './platform/tenant-context/tenant-context.guard';
import { TenantContextModule } from './platform/tenant-context/tenant-context.module';
import { WorkerModule } from './platform/worker/worker.module';

/**
 * Every global guard of the application, in the order they run. TenantContextGuard is first,
 * so a request without a valid tenant reaches nothing else; ActorGuard is second and attaches
 * the request's actor. No other module declares APP_GUARD, and `main.ts` adds no
 * `useGlobalGuards`; a test asserts this list and its order.
 */
export const GLOBAL_GUARDS = [TenantContextGuard, ActorGuard] as const;

export interface AppModuleOptions {
  /** Overrides the configuration read from `process.env` (tests). */
  readonly config?: AppConfig;
  /** Overrides where log lines are written (tests). */
  readonly logDestination?: DestinationStream;
}

/**
 * Composition root of the modular monolith (ADR-01). Registers the platform runtime; the
 * business modules arrive from Phase 1. Both process roles build this same graph.
 */
@Module({})
export class AppModule {
  static register(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(options.config),
        LoggingModule.forRoot(options.logDestination),
        ClockModule,
        IdsModule,
        TenantConfigModule,
        TenantContextModule,
        PersistenceModule,
        StorageModule,
        WorkerModule,
        HealthModule,
      ],
      providers: [
        ...GLOBAL_GUARDS.map((guard) => ({ provide: APP_GUARD, useClass: guard })),
        // 409 for TransactionConflictError and StaleAggregateError.
        { provide: APP_FILTER, useClass: ConflictFilter },
      ],
    };
  }
}
