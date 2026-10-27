import { Module, type Provider } from '@nestjs/common';
import type { Clock, IdGenerator } from '@phoenix/shared-kernel';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER } from '../../platform/audit/audit-writer';
import { registerPermissions, USE_CASE_GATE } from '../../platform/authz';
import { CLOCK } from '../../platform/clock/clock.module';
import type { AppConfig } from '../../platform/config/app-config';
import { APP_CONFIG } from '../../platform/config/config.module';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { registerJobsFrom } from '../../platform/scheduler/job-registry';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/unit-of-work/unit-of-work';
import { CommandRelay } from './application/bridge/command-relay';
import { EngineSync } from './application/bridge/engine-sync';
import { EngineCommands } from './application/engine-commands';
import { BRIDGE_HASHING, type BridgeHashing } from './application/ports/bridge-hashing';
import { PROCESS_ENGINE, type ProcessEngine } from './application/ports/process-engine';
import { PROCESS_REPOSITORY, type ProcessRepository } from './application/process.repository';
import { ListProcessIncidents } from './application/use-cases/list-process-incidents.use-case';
import { PublishProcessRevision } from './application/use-cases/publish-process-revision.use-case';
import { RelayEngineCommands } from './application/use-cases/relay-engine-commands.use-case';
import { StartProcessInstance } from './application/use-cases/start-process-instance.use-case';
import { SyncEngine } from './application/use-cases/sync-engine.use-case';
import { PROCESS_PERMISSIONS } from './contracts/permissions';
import { PROCESS_AUDIT_ACTIONS } from './domain/audit-actions';
import { FlowableRestEngine } from './infrastructure/flowable/flowable-rest-engine';
import { NodeBridgeHashing } from './infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from './infrastructure/prisma-process.repository';
import { UnconfiguredEngine } from './infrastructure/unconfigured-engine';
import { relayEngineCommandsJob } from './presentation/jobs/relay-engine-commands.job';
import { syncEngineJob } from './presentation/jobs/sync-engine.job';
import { ProcessIncidentsController } from './presentation/process-incidents.controller';
import { ProcessRevisionsController } from './presentation/process-revisions.controller';

/** Each use case built with the gate first and its ports after, in constructor order. */
function useCase(type: abstract new (...args: never[]) => unknown, inject: unknown[]): Provider {
  return {
    provide: type,
    inject: [USE_CASE_GATE, ...inject] as never[],
    useFactory: (...deps: unknown[]) =>
      new (type as unknown as new (...args: unknown[]) => unknown)(...deps),
  };
}

const REPOSITORY = PROCESS_REPOSITORY;

/**
 * The process module (Phase 2 slice 2.2): the bridge to Flowable. Publishing a process model
 * deploys it per tenant; the relay sends the core's commands with a lease; the sync reads the
 * engine's tasks and ended instances into the core with watermarks and records incidents. The
 * task inbox (2.3) and the form link (2.6) build on it.
 */
@Module({
  controllers: [ProcessRevisionsController, ProcessIncidentsController],
  providers: [
    registerPermissions('process', PROCESS_PERMISSIONS),
    registerAuditActions('process', PROCESS_AUDIT_ACTIONS),
    PersistenceModule.auditWriterFor('process'),
    { provide: REPOSITORY, useClass: PrismaProcessRepository },
    { provide: BRIDGE_HASHING, useClass: NodeBridgeHashing },
    {
      provide: PROCESS_ENGINE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ProcessEngine =>
        config.flowable === null
          ? new UnconfiguredEngine()
          : new FlowableRestEngine(config.flowable),
    },
    {
      provide: EngineCommands,
      inject: [REPOSITORY, ID_GENERATOR, CLOCK],
      useFactory: (repository: ProcessRepository, ids: IdGenerator, clock: Clock) =>
        new EngineCommands(repository, ids, clock),
    },
    {
      provide: CommandRelay,
      inject: [UNIT_OF_WORK, REPOSITORY, EngineCommands, PROCESS_ENGINE, ID_GENERATOR, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        repository: ProcessRepository,
        commands: EngineCommands,
        engine: ProcessEngine,
        ids: IdGenerator,
        clock: Clock,
      ) => new CommandRelay(unitOfWork, repository, commands, engine, ids, clock),
    },
    {
      provide: EngineSync,
      inject: [
        UNIT_OF_WORK,
        REPOSITORY,
        EngineCommands,
        PROCESS_ENGINE,
        BRIDGE_HASHING,
        ID_GENERATOR,
        CLOCK,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        repository: ProcessRepository,
        commands: EngineCommands,
        engine: ProcessEngine,
        hashing: BridgeHashing,
        ids: IdGenerator,
        clock: Clock,
      ) => new EngineSync(unitOfWork, repository, commands, engine, hashing, ids, clock),
    },
    useCase(PublishProcessRevision, [
      UNIT_OF_WORK,
      REPOSITORY,
      EngineCommands,
      BRIDGE_HASHING,
      AUDIT_WRITER,
      CLOCK,
      ID_GENERATOR,
    ]),
    useCase(StartProcessInstance, [UNIT_OF_WORK, REPOSITORY, EngineCommands, CLOCK, ID_GENERATOR]),
    useCase(ListProcessIncidents, [UNIT_OF_WORK, REPOSITORY]),
    useCase(RelayEngineCommands, [CommandRelay]),
    useCase(SyncEngine, [EngineSync]),
    registerJobsFrom(
      'process',
      [RelayEngineCommands, SyncEngine],
      (relay: RelayEngineCommands, sync: SyncEngine) => [
        relayEngineCommandsJob(relay),
        syncEngineJob(sync),
      ],
    ),
  ],
})
export class ProcessModule {}
