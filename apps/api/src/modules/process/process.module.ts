import { Module, type Provider } from '@nestjs/common';
import type { Clock, IdGenerator } from '@phoenix/shared-kernel';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER, type AuditWriter } from '../../platform/audit/audit-writer';
import {
  registerPermissions,
  ROLE_HOLDING_READER,
  SITE_ANCESTRY_READER,
  USE_CASE_GATE,
  type RoleHoldingReader,
  type SiteAncestryReader,
} from '../../platform/authz';
import { CLOCK } from '../../platform/clock/clock.module';
import { registerSubscriptionsFrom } from '../../platform/events/event-subscriptions';
import type { AppConfig } from '../../platform/config/app-config';
import { APP_CONFIG } from '../../platform/config/config.module';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { registerJobsFrom } from '../../platform/scheduler/job-registry';
import { TenantRegistry } from '../../platform/tenant-config/tenant-registry';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/unit-of-work/unit-of-work';
import { FORM_REFERENCES, FormsModule } from '../forms';
import { CommandRelay } from './application/bridge/command-relay';
import { EngineSync } from './application/bridge/engine-sync';
import { EngineCommands } from './application/engine-commands';
import { BRIDGE_HASHING, type BridgeHashing } from './application/ports/bridge-hashing';
import { PROCESS_ENGINE, type ProcessEngine } from './application/ports/process-engine';
import { PROCESS_REPOSITORY, type ProcessRepository } from './application/process.repository';
import { TaskInbox } from './application/task-inbox';
import { AssignTask } from './application/use-cases/assign-task.use-case';
import { ClaimTask } from './application/use-cases/claim-task.use-case';
import { CompleteTask } from './application/use-cases/complete-task.use-case';
import { EscalateOverdueTasks } from './application/use-cases/escalate-overdue-tasks.use-case';
import { ListMyTasks } from './application/use-cases/list-my-tasks.use-case';
import { ListProcessIncidents } from './application/use-cases/list-process-incidents.use-case';
import { ListSiteTasks } from './application/use-cases/list-site-tasks.use-case';
import { PublishDecisionRevision } from './application/use-cases/publish-decision-revision.use-case';
import { PublishProcessRevision } from './application/use-cases/publish-process-revision.use-case';
import { RelayEngineCommands } from './application/use-cases/relay-engine-commands.use-case';
import { ReleaseTask } from './application/use-cases/release-task.use-case';
import { ReplaceWorkingCalendar } from './application/use-cases/replace-working-calendar.use-case';
import { StartProcessFromSubmission } from './application/use-cases/start-process-from-submission.use-case';
import { StartProcessInstance } from './application/use-cases/start-process-instance.use-case';
import { SyncEngine } from './application/use-cases/sync-engine.use-case';
import { ViewTask } from './application/use-cases/view-task.use-case';
import { ViewWorkingCalendar } from './application/use-cases/view-working-calendar.use-case';
import { PROCESS_PERMISSIONS } from './contracts/permissions';
import { PROCESS_AUDIT_ACTIONS } from './domain/audit-actions';
import { FlowableRestEngine } from './infrastructure/flowable/flowable-rest-engine';
import { NodeBridgeHashing } from './infrastructure/node-bridge-hashing';
import { PrismaProcessRepository } from './infrastructure/prisma-process.repository';
import { UnconfiguredEngine } from './infrastructure/unconfigured-engine';
import { escalateOverdueTasksJob } from './presentation/jobs/escalate-overdue-tasks.job';
import { relayEngineCommandsJob } from './presentation/jobs/relay-engine-commands.job';
import { syncEngineJob } from './presentation/jobs/sync-engine.job';
import { startFromSubmissionSubscriber } from './presentation/subscribers/start-from-submission.subscriber';
import { ProcessIncidentsController } from './presentation/process-incidents.controller';
import {
  ProcessDecisionsController,
  ProcessRevisionsController,
} from './presentation/process-revisions.controller';
import { ProcessTasksController } from './presentation/process-tasks.controller';
import { WorkingCalendarController } from './presentation/working-calendar.controller';

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
 * task inbox (slice 2.3, ADR-0025) assigns, claims and completes tasks, with deadlines on the
 * tenant's working calendar and escalation. The form link (2.6): a revision pins the form
 * revisions its model names, through the forms facade; a stored submission starts the process
 * its form starts (forms.submission-received.v1), and each task carries its form revision.
 */
@Module({
  imports: [FormsModule],
  controllers: [
    ProcessRevisionsController,
    ProcessDecisionsController,
    ProcessIncidentsController,
    ProcessTasksController,
    WorkingCalendarController,
  ],
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
      inject: [
        UNIT_OF_WORK,
        REPOSITORY,
        EngineCommands,
        PROCESS_ENGINE,
        ID_GENERATOR,
        CLOCK,
        AUDIT_WRITER,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        repository: ProcessRepository,
        commands: EngineCommands,
        engine: ProcessEngine,
        ids: IdGenerator,
        clock: Clock,
        audit: AuditWriter,
      ) => new CommandRelay(unitOfWork, repository, commands, engine, ids, clock, audit),
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
        TenantRegistry,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        repository: ProcessRepository,
        commands: EngineCommands,
        engine: ProcessEngine,
        hashing: BridgeHashing,
        ids: IdGenerator,
        clock: Clock,
        tenants: TenantRegistry,
      ) => new EngineSync(unitOfWork, repository, commands, engine, hashing, ids, clock, tenants),
    },
    {
      provide: TaskInbox,
      inject: [UNIT_OF_WORK, REPOSITORY, ROLE_HOLDING_READER, SITE_ANCESTRY_READER, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        repository: ProcessRepository,
        holdings: RoleHoldingReader,
        sites: SiteAncestryReader,
        clock: Clock,
      ) => new TaskInbox(unitOfWork, repository, holdings, sites, clock),
    },
    useCase(PublishProcessRevision, [
      UNIT_OF_WORK,
      REPOSITORY,
      EngineCommands,
      BRIDGE_HASHING,
      AUDIT_WRITER,
      FORM_REFERENCES,
      CLOCK,
      ID_GENERATOR,
    ]),
    useCase(PublishDecisionRevision, [
      UNIT_OF_WORK,
      REPOSITORY,
      EngineCommands,
      BRIDGE_HASHING,
      AUDIT_WRITER,
      CLOCK,
      ID_GENERATOR,
    ]),
    useCase(StartProcessFromSubmission, [
      UNIT_OF_WORK,
      REPOSITORY,
      EngineCommands,
      SITE_ANCESTRY_READER,
      CLOCK,
      ID_GENERATOR,
    ]),
    registerSubscriptionsFrom(
      'process',
      [StartProcessFromSubmission],
      (start: StartProcessFromSubmission) => [startFromSubmissionSubscriber(start)],
    ),
    useCase(StartProcessInstance, [UNIT_OF_WORK, REPOSITORY, EngineCommands, CLOCK, ID_GENERATOR]),
    useCase(ListProcessIncidents, [UNIT_OF_WORK, REPOSITORY]),
    useCase(RelayEngineCommands, [CommandRelay]),
    useCase(SyncEngine, [EngineSync]),
    useCase(ListMyTasks, [TaskInbox, REPOSITORY]),
    useCase(ListSiteTasks, [TaskInbox, REPOSITORY]),
    useCase(ViewTask, [TaskInbox]),
    useCase(ClaimTask, [TaskInbox, UNIT_OF_WORK, REPOSITORY, AUDIT_WRITER]),
    useCase(ReleaseTask, [TaskInbox, UNIT_OF_WORK, REPOSITORY, AUDIT_WRITER]),
    useCase(AssignTask, [TaskInbox, UNIT_OF_WORK, REPOSITORY, AUDIT_WRITER]),
    useCase(CompleteTask, [TaskInbox, UNIT_OF_WORK, EngineCommands, AUDIT_WRITER]),
    useCase(EscalateOverdueTasks, [UNIT_OF_WORK, REPOSITORY, AUDIT_WRITER, CLOCK]),
    useCase(ViewWorkingCalendar, [UNIT_OF_WORK, REPOSITORY]),
    useCase(ReplaceWorkingCalendar, [UNIT_OF_WORK, REPOSITORY, AUDIT_WRITER, CLOCK]),
    registerJobsFrom(
      'process',
      [RelayEngineCommands, SyncEngine, EscalateOverdueTasks],
      (relay: RelayEngineCommands, sync: SyncEngine, escalate: EscalateOverdueTasks) => [
        relayEngineCommandsJob(relay),
        syncEngineJob(sync),
        escalateOverdueTasksJob(escalate),
      ],
    ),
  ],
})
export class ProcessModule {}
