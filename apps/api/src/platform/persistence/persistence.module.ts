import { Global, Module, type FactoryProvider } from '@nestjs/common';
import type { Clock, IdGenerator } from '@phoenix/shared-kernel';
import { MODEL_MAP } from '../../generated/model-map';
import { PERMISSION_KEY_LOOKUP, type PermissionKeyLookup } from '../authz/permission-key-lookup';
import { CLOCK } from '../clock/clock.module';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { EVENT_BUS, OUTBOX_RELAY, type EventBus } from '../events/event-bus';
import { EventCatalogue } from '../events/event-catalogue';
import { EVENT_DISPATCHER } from '../events/event-delivery';
import { SubscriptionRegistry } from '../events/event-subscriptions';
import { OUTBOX_WRITER, type OutboxWriter } from '../events/outbox-writer';
import { ID_GENERATOR } from '../ids/ids.module';
import { JOB_LOCK } from '../scheduler/job-lock';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { UNIT_OF_WORK } from '../unit-of-work/unit-of-work';
import { AdvisoryJobLock } from './advisory-job-lock';
import { DatabaseProbe } from './database-probe';
import { createGuardedClient, GUARDED_CLIENT, type GuardedClient } from './guarded-client';
import type { ModelMap } from './model-map';
import { InProcessEventBus } from './outbox/in-process-event-bus';
import { PrismaEventDispatcher } from './outbox/prisma-event-dispatcher';
import { PrismaOutboxRelay } from './outbox/prisma-outbox-relay';
import { PrismaOutboxWriterFactory } from './outbox/prisma-outbox-writer';
import { PrismaRoot } from './prisma-root';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

/** The generated map, checked against the shape the guard reads. */
const modelMap: ModelMap = MODEL_MAP;

/**
 * Persistence (ported from Mondapac's platform persistence design, "P", 3.3, 5 to 7). Exports
 * the guarded door for modules (`PrismaService`), the `UnitOfWork` port, `DatabaseProbe`, and
 * the implementations of the event and scheduler ports (relay, bus, dispatcher, job lock);
 * never the base client (`PrismaRoot`) or the guarded client, so Nest cannot inject them
 * elsewhere. The outbox writer factory is not a provider at all: a module reaches only its own
 * writer, through {@link PersistenceModule.outboxWriterFor}. A static method, not a named
 * export, so this file still exports only `PersistenceModule` (boundaries.spec.ts). The audit,
 * raw-read and rate-limit bindings of Mondapac are deferred (docs/platform-deferred.md).
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
    {
      provide: EVENT_BUS,
      inject: [SubscriptionRegistry, CLOCK],
      useFactory: (subscriptions: SubscriptionRegistry, clock: Clock) =>
        new InProcessEventBus(subscriptions, clock),
    },
    {
      provide: EVENT_DISPATCHER,
      inject: [PrismaRoot, TenantRegistry, TenantContextFactory, SubscriptionRegistry, CLOCK],
      useFactory: (
        root: PrismaRoot,
        tenants: TenantRegistry,
        contexts: TenantContextFactory,
        subscriptions: SubscriptionRegistry,
        clock: Clock,
      ) => new PrismaEventDispatcher(root, tenants, contexts, subscriptions, clock),
    },
    {
      provide: OUTBOX_RELAY,
      inject: [PrismaRoot, TenantRegistry, TenantContextFactory, EVENT_BUS, CLOCK],
      useFactory: (
        root: PrismaRoot,
        tenants: TenantRegistry,
        contexts: TenantContextFactory,
        bus: EventBus,
        clock: Clock,
      ) => new PrismaOutboxRelay(root, modelMap, tenants, contexts, bus, clock),
    },
    {
      provide: JOB_LOCK,
      inject: [PrismaRoot],
      useFactory: (root: PrismaRoot) => new AdvisoryJobLock(root),
    },
  ],
  exports: [
    PrismaService,
    UNIT_OF_WORK,
    DatabaseProbe,
    EVENT_BUS,
    OUTBOX_RELAY,
    EVENT_DISPATCHER,
    JOB_LOCK,
  ],
})
export class PersistenceModule {
  /**
   * Ported from Mondapac. The one line of a module's Nest module that binds its own outbox
   * writer (P 5.2): `providers: [PersistenceModule.outboxWriterFor('content')]`. The name is
   * the module's folder. The writer is built here from the exported door (`PrismaService`) and
   * the global catalogue, id generator and permission-key lookup, so no module-to-writer
   * factory is ever injectable: a module cannot resolve the factory or another module's writer
   * (Mondapac security review of slice 1b, M1). A module never exports `OUTBOX_WRITER`.
   */
  static outboxWriterFor(module: string): FactoryProvider<OutboxWriter> {
    return {
      provide: OUTBOX_WRITER,
      inject: [PrismaService, EventCatalogue, ID_GENERATOR, PERMISSION_KEY_LOOKUP],
      useFactory: (
        prisma: PrismaService,
        catalogue: EventCatalogue,
        ids: IdGenerator,
        permissionKeys: PermissionKeyLookup,
      ) =>
        new PrismaOutboxWriterFactory(modelMap, prisma, catalogue, ids, permissionKeys).forModule(
          module,
        ),
    };
  }
}
