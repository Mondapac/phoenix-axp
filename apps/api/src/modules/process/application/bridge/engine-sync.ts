import { err, ok, parseId } from '@phoenix/shared-kernel';
import type {
  CallContext,
  Clock,
  Id,
  IdGenerator,
  Temporal,
  TenantContext,
} from '@phoenix/shared-kernel';
import type { TenantRegistry } from '../../../../platform/tenant-config/tenant-registry';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { dueAt } from '../../domain/deadline';
import type { IncidentKind } from '../../domain/incident';
import { adoptionOf, endStatusOf } from '../../domain/instance';
import { statusOnEngineEnd } from '../../domain/task';
import { advance, queryFrom } from '../../domain/watermark';
import type { EngineCommands } from '../engine-commands';
import { settingsOf } from '../inbox-access';
import type { BridgeHashing } from '../ports/bridge-hashing';
import type {
  EngineInstance,
  EngineOpenTask,
  EngineTaskRecord,
  ProcessEngine,
} from '../ports/process-engine';
import type { InstanceRecord, ProcessRepository, TaskRecord } from '../process.repository';

/** The inbox handlers of the sync: `(tenant_id, event_id, handler)` is the dedup key. */
export const SYNC_HANDLERS = Object.freeze({
  surfaceTask: 'process.surface-task',
  closeTask: 'process.close-task',
  closeInstance: 'process.close-instance',
  flagOrphan: 'process.flag-orphan',
  flagUnknown: 'process.flag-unknown',
});

/** Ended tasks and instances read per pass; the rest is read by the next pass. */
export const SYNC_READ_LIMIT = 500;
/** Core tasks per pass whose history is read one by one (open in the core, gone in the engine). */
export const BACKFILL_LIMIT = 50;
/** Core open tasks read per unit. */
const OPEN_TASK_PAGE = 1000;

export interface SyncPass {
  /** Observations applied for the first time. */
  readonly applied: number;
  /** Observations the inbox had already (a repeated poll, or a concurrent worker). */
  readonly duplicates: number;
}

type Outcome = 'applied' | 'duplicate' | 'deferred';

/**
 * Engine -> core (ADR-0005 decision 3, polling; PoC 3 R5): each pass re-reads the tenant's
 * engine state and turns what it finds into observations, each with an event id derived from
 * what it observed (`task-opened:<task>`), so a repeated pass or a second worker derives the same
 * id and the observation inbox makes it a no-op. Per pass:
 *
 *   1. the open tasks: surface new ones, adopting the instance first writer wins, and flag
 *      orphan and unknown instances;
 *   2. the tasks that ended after the task watermark: close the core's, backfill the ones that
 *      opened and ended between two passes;
 *   3. the instances that ended after the instance watermark: close the core's;
 *   4. core tasks still open that neither 1 nor 2 saw: read their history one by one;
 *   5. save the watermarks.
 *
 * Polling, not push: an outage of either side only delays the next pass, which reads the truth.
 */
export class EngineSync {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly engine: ProcessEngine,
    private readonly hashing: BridgeHashing,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly tenants: TenantRegistry,
  ) {}

  async runOnce(context: CallContext): Promise<SyncPass> {
    const { tenant } = context;
    const counts = { applied: 0, duplicates: 0 };
    const count = (outcome: Outcome) => {
      if (outcome === 'applied') counts.applied += 1;
      if (outcome === 'duplicate') counts.duplicates += 1;
    };
    const state = await this.read(tenant, () => this.repository.readSyncState(tenant));
    const coreOpen = await this.openCoreTasks(tenant);
    const known = new Set(coreOpen.map((task) => task.engineTaskId));
    const seen = new Set<string>();

    for (const task of await this.engine.listOpenTasks(tenant)) {
      seen.add(task.engineTaskId);
      // Surfaced on an earlier pass: nothing changed while it stays open.
      if (!known.has(task.engineTaskId)) count(await this.observeOpenTask(context, task));
    }

    const endedTasks = await this.engine.listEndedTasks(
      tenant,
      queryFrom(state.tasksEndedAfter),
      SYNC_READ_LIMIT,
    );
    for (const record of endedTasks) {
      seen.add(record.engineTaskId);
      count(await this.observeEndedTask(context, record));
    }

    const endedInstances = await this.engine.listEndedInstances(
      tenant,
      queryFrom(state.instancesEndedAfter),
      SYNC_READ_LIMIT,
    );
    for (const instance of endedInstances) count(await this.observeEndedInstance(tenant, instance));

    // A task the watermark missed (an engine clock far behind) is read from history.
    const stale = coreOpen.filter((task) => !seen.has(task.engineTaskId));
    for (const task of stale.slice(0, BACKFILL_LIMIT)) {
      const record = await this.engine.findTask(tenant, task.engineTaskId);
      if (record?.end) count(await this.observeEndedTask(context, record));
    }

    const ends = (items: readonly { endedAt: Temporal.Instant | null }[]) =>
      items.flatMap((item) => (item.endedAt === null ? [] : [item.endedAt]));
    await this.unitOfWork.run<boolean, never>(tenant, async () =>
      ok(
        await this.repository.saveSyncState(
          tenant,
          {
            tasksEndedAfter: advance(state.tasksEndedAfter, ends(endedTasks)),
            instancesEndedAfter: advance(state.instancesEndedAfter, ends(endedInstances)),
          },
          state.version,
          this.clock.now(),
        ),
      ),
    );
    return counts;
  }

  private async observeOpenTask(context: CallContext, task: EngineOpenTask): Promise<Outcome> {
    const { tenant } = context;
    const instance = await this.coreInstanceOf(tenant, task.coreInstanceId);
    if (instance === null) {
      return this.flag(tenant, 'unknown-instance', task.engineInstanceId, null);
    }
    if (adoptionOf(instance.engineInstanceId, task.engineInstanceId) === 'orphan') {
      return this.flagOrphan(context, instance.id, task.engineInstanceId);
    }
    return this.surfaceTask(tenant, instance, task, null);
  }

  private async observeEndedTask(context: CallContext, record: EngineTaskRecord): Promise<Outcome> {
    const { tenant } = context;
    const known = await this.read(tenant, () =>
      this.repository.findTaskByEngineId(tenant, record.engineTaskId),
    );
    if (known !== null) return this.closeTask(tenant, known, record);

    // Opened and ended between two passes: recorded closed, so the history has no gap.
    const instance = await this.coreInstanceOf(tenant, record.coreInstanceId);
    if (instance === null) {
      return this.flag(tenant, 'unknown-instance', record.engineInstanceId, null);
    }
    if (adoptionOf(instance.engineInstanceId, record.engineInstanceId) === 'orphan') {
      return this.flagOrphan(context, instance.id, record.engineInstanceId);
    }
    return this.surfaceTask(tenant, instance, record, record);
  }

  private async observeEndedInstance(
    tenant: TenantContext,
    engineInstance: EngineInstance,
  ): Promise<Outcome> {
    const instance = await this.coreInstanceOf(tenant, engineInstance.businessKey);
    if (instance === null) {
      return this.flag(tenant, 'unknown-instance', engineInstance.engineInstanceId, null);
    }
    // An orphan ends when the core removes it: nothing more to do.
    if (adoptionOf(instance.engineInstanceId, engineInstance.engineInstanceId) === 'orphan') {
      return 'duplicate';
    }
    const eventId = this.eventId(tenant, 'instance-ended', engineInstance.engineInstanceId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.closeInstance, async () => {
      const recorded = await this.repository.adoptEngineInstance(
        tenant,
        instance.id,
        engineInstance.engineInstanceId,
      );
      if (recorded !== engineInstance.engineInstanceId) return 'deferred';
      await this.repository.endInstance(
        tenant,
        instance.id,
        endStatusOf(engineInstance.deleted),
        this.clock.now(),
      );
      return 'applied';
    });
  }

  /**
   * Records a task of the adopted instance: open, or closed when `ended` says how it ended. The
   * inbox columns come with it (ADR-0025): the instance's site, and the modeller's settings of
   * the task in the instance's revision, its deadline counted from now in the tenant's time
   * zone and, for working days, on the tenant's working calendar.
   */
  private surfaceTask(
    tenant: TenantContext,
    instance: InstanceRecord,
    task: EngineOpenTask,
    ended: EngineTaskRecord | null,
  ): Promise<Outcome> {
    const instanceId = instance.id;
    const end = ended === null ? null : ended.end;
    const closed =
      end === null ? null : statusOnEngineEnd({ status: 'open', completionKey: null }, end);
    const eventId = this.eventId(tenant, 'task-opened', task.engineTaskId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.surfaceTask, async () => {
      // First writer wins: the relay's start ack may have adopted another instance meanwhile.
      const recorded = await this.repository.adoptEngineInstance(
        tenant,
        instanceId,
        task.engineInstanceId,
      );
      if (recorded !== task.engineInstanceId) return 'deferred';
      const settings = settingsOf(
        await this.repository.findTaskSettings(tenant, instance.revisionId),
        task.taskKey,
      );
      const now = this.clock.now();
      let due: Temporal.Instant | null = null;
      if (settings.deadline !== null) {
        const calendar = await this.repository.readWorkingCalendar(tenant);
        try {
          due = dueAt(now, this.tenants.get(tenant.tenantId).timeZone, settings.deadline, {
            weekendDays: new Set(calendar.weekendDays),
            holidays: new Set(calendar.holidays),
          });
        } catch (error) {
          // A calendar with no working day (the table's CHECKs refuse one): the task waits in
          // its queue with no deadline rather than stopping the tenant's sync on every pass.
          if (!(error instanceof RangeError)) throw error;
        }
      }
      await this.repository.insertTask(
        tenant,
        {
          id: this.ids.next<'ProcessTask'>(),
          instanceId,
          engineTaskId: task.engineTaskId,
          taskKey: task.taskKey,
          formKey: task.formKey,
          status: closed === null ? 'open' : closed.status,
          siteId: instance.siteId,
          name: settings.name,
          candidateRoleId: settings.candidateRoleId,
          assigneeAccountId: settings.assigneeAccountId,
          dueAt: due,
          escalationRoleId: due === null ? null : settings.escalationRoleId,
          outcomes: settings.outcomes,
        },
        now,
      );
      if (closed !== null && closed.incident !== null) {
        await this.incident(tenant, closed.incident, task.engineTaskId, instanceId);
      }
      return 'applied';
    });
  }

  private closeTask(
    tenant: TenantContext,
    task: TaskRecord,
    record: EngineTaskRecord,
  ): Promise<Outcome> {
    const eventId = this.eventId(tenant, 'task-ended', task.engineTaskId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.closeTask, async () => {
      const fresh = await this.repository.findTask(tenant, task.id);
      const next =
        fresh === null || record.end === null ? null : statusOnEngineEnd(fresh, record.end);
      if (fresh === null || next === null) return 'applied';
      if (!(await this.repository.closeTask(tenant, fresh, next.status, this.clock.now()))) {
        return 'deferred';
      }
      if (next.incident !== null) {
        await this.incident(tenant, next.incident, fresh.engineTaskId, fresh.instanceId);
      }
      return 'applied';
    });
  }

  /** An engine instance the core did not adopt: flagged and removed by a command, once. */
  private flagOrphan(
    context: CallContext,
    instanceId: Id<'ProcessInstance'>,
    engineInstanceId: string,
  ): Promise<Outcome> {
    const { tenant } = context;
    const eventId = this.eventId(tenant, 'orphan-instance', engineInstanceId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.flagOrphan, async () => {
      await this.incident(tenant, 'orphan-instance', engineInstanceId, instanceId);
      await this.commands.deleteOrphan(tenant, context.correlationId, instanceId, engineInstanceId);
      return 'applied';
    });
  }

  private flag(
    tenant: TenantContext,
    kind: IncidentKind,
    engineRef: string,
    instanceId: Id<'ProcessInstance'> | null,
  ): Promise<Outcome> {
    const eventId = this.eventId(tenant, kind, engineRef);
    return this.apply(tenant, eventId, SYNC_HANDLERS.flagUnknown, async () => {
      await this.incident(tenant, kind, engineRef, instanceId);
      return 'applied';
    });
  }

  /**
   * One observation, one unit: the inbox row and the change commit together. A repeat finds
   * its row and changes nothing; a `deferred` one rolls back so the next pass sees it again.
   */
  private async apply(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    work: () => Promise<'applied' | 'deferred'>,
  ): Promise<Outcome> {
    const result = await this.unitOfWork.run<Outcome, 'deferred'>(tenant, async () => {
      if (!(await this.repository.recordObservation(tenant, eventId, handler, this.clock.now()))) {
        return ok('duplicate');
      }
      return (await work()) === 'deferred' ? err('deferred') : ok('applied');
    });
    return result.ok ? result.value : 'deferred';
  }

  /** The core instance named by an engine value, if it is an id of an open or ended instance. */
  private async coreInstanceOf(tenant: TenantContext, value: string | null) {
    const id = value === null ? null : parseId<'ProcessInstance'>(value);
    if (id === null || !id.ok) return null;
    return this.read(tenant, () => this.repository.findInstance(tenant, id.value));
  }

  /** Every open or completing task of the core, read in pages. */
  private async openCoreTasks(tenant: TenantContext): Promise<TaskRecord[]> {
    const all: TaskRecord[] = [];
    for (;;) {
      const after = all.length === 0 ? null : all[all.length - 1]!.id;
      const page = await this.read(tenant, () =>
        this.repository.openTasks(tenant, after, OPEN_TASK_PAGE),
      );
      all.push(...page);
      if (page.length < OPEN_TASK_PAGE) return all;
    }
  }

  private incident(
    tenant: TenantContext,
    kind: IncidentKind,
    engineRef: string,
    instanceId: Id<'ProcessInstance'> | null,
  ): Promise<void> {
    return this.repository.recordIncident(tenant, {
      id: this.ids.next<'ProcessIncident'>(),
      kind,
      engineRef,
      instanceId,
      detectedAt: this.clock.now(),
    });
  }

  private eventId(tenant: TenantContext, kind: string, engineRef: string): string {
    return this.hashing.derivedId([tenant.tenantId, kind, engineRef]);
  }

  private async read<T>(tenant: TenantContext, work: () => Promise<T>): Promise<T> {
    const result = await this.unitOfWork.run(tenant, async () => ok(await work()), {
      readOnly: true,
    });
    if (!result.ok) throw new Error('unreachable: a read unit returned err');
    return result.value;
  }
}
