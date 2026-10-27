import { err, ok, parseId } from '@phoenix/shared-kernel';
import type { Clock, IdGenerator, TenantContext } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { adoptInstance, finalStatus } from '../../domain/request';
import { OPEN_STATUSES, statusOnEngineEnd, type IncidentKind } from '../../domain/task';
import type { ContentHasher } from '../ports/collaborators';
import type { EngineOpenTask, EngineTaskRecord, ProcessEngine } from '../ports/process-engine';
import type { ProcessStore, RequestRecord, TaskRecord } from '../ports/process-store';

/** The inbox handlers of the bridge: `(event_id, handler)` is the dedup key (ADR-0006). */
export const SYNC_HANDLERS = Object.freeze({
  surfaceTask: 'process.surface-task',
  closeTask: 'process.close-task',
  closeRequest: 'process.close-request',
  flagOrphan: 'process.flag-orphan',
  flagUnknown: 'process.flag-unknown',
});

export interface SyncPass {
  /** Observations applied for the first time. */
  readonly applied: number;
  /** Observations the inbox had seen already (a repeated poll or a concurrent worker). */
  readonly duplicates: number;
}

type Outcome = 'applied' | 'duplicate' | 'deferred';

/**
 * Engine -> core (ADR-0005 decision 3, the polling variant): each pass reads the tenant's
 * engine state and turns what changed into observations, each with an event id derived from
 * what it observes (`task-opened:<task>`, `task-ended:<task>`, `instance-ended:<instance>`).
 * A repeated poll derives the same id, so `process.inbox` turns every repeat into a no-op;
 * the unique `(tenant_id, engine_task_id)` of the task table is the second guard.
 *
 * Polling, not push: an engine outage, a core outage or a lost message only delays the next
 * pass, which re-reads the truth. Nothing the engine did while the core was down is missed.
 */
export class EngineSync {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: ProcessStore,
    private readonly engine: ProcessEngine,
    private readonly hasher: ContentHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async runOnce(tenant: TenantContext): Promise<SyncPass> {
    const counts = { applied: 0, duplicates: 0 };
    const count = (outcome: Outcome) => {
      if (outcome === 'applied') counts.applied += 1;
      if (outcome === 'duplicate') counts.duplicates += 1;
    };

    const open = await this.engine.listOpenTasks(tenant);
    for (const task of open) count(await this.observeOpenTask(tenant, task));

    const openIds = new Set(open.map((task) => task.engineTaskId));
    const openInstances = new Set(open.map((task) => task.processInstanceId));
    const core = await this.read(tenant, () =>
      this.store.tasks(tenant, { statuses: OPEN_STATUSES }),
    );
    for (const task of core) {
      if (openIds.has(task.engineTaskId)) continue;
      const record = await this.engine.findTask(tenant, task.engineTaskId);
      if (record?.end) count(await this.observeEndedTask(tenant, task, record));
    }

    const running = await this.read(tenant, () => this.store.runningRequests(tenant));
    for (const request of running) {
      const instanceId = request.processInstanceId;
      if (instanceId === null) continue;
      // Tasks that opened and ended between two passes (a core outage longer than a deadline)
      // were never seen open: they are recorded closed, so the inbox history has no gap.
      const known = new Set(
        (await this.read(tenant, () => this.store.tasks(tenant, { requestId: request.id }))).map(
          (task) => task.engineTaskId,
        ),
      );
      for (const record of await this.engine.listInstanceTasks(tenant, instanceId)) {
        if (record.end !== null && !known.has(record.engineTaskId)) {
          count(await this.backfillTask(tenant, request, record));
        }
      }
      if (openInstances.has(instanceId)) continue;
      const instance = await this.engine.findInstance(tenant, instanceId);
      if (instance?.ended) {
        const eventId = this.eventId(tenant, 'instance-ended', instance.instanceId);
        count(
          await this.apply(tenant, eventId, SYNC_HANDLERS.closeRequest, async () => {
            await this.store.closeRequest(
              tenant,
              request.id,
              finalStatus(instance.decision, instance.deleted),
            );
            return 'applied';
          }),
        );
      }
    }
    return counts;
  }

  private async observeOpenTask(tenant: TenantContext, task: EngineOpenTask): Promise<Outcome> {
    const request =
      task.requestId === null
        ? null
        : await this.read(tenant, () => this.store.findRequest(tenant, task.requestId!));
    const assignee = task.assigneeId === null ? null : parseId(task.assigneeId);
    if (request === null || assignee === null || !assignee.ok) {
      return this.flag(
        tenant,
        SYNC_HANDLERS.flagUnknown,
        'unknown-request',
        task.engineTaskId,
        null,
      );
    }

    if (adoptInstance(request.processInstanceId, task.processInstanceId) === 'orphan') {
      return this.removeOrphan(tenant, task.processInstanceId, request);
    }

    const eventId = this.eventId(tenant, 'task-opened', task.engineTaskId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.surfaceTask, async () => {
      // First writer wins: the relay's start ack may have adopted another instance meanwhile.
      const stored = await this.store.adoptInstance(tenant, request.id, task.processInstanceId);
      if (stored !== task.processInstanceId) return 'deferred';
      await this.store.insertTask(tenant, {
        id: this.ids.next<'Task'>(),
        requestId: request.id,
        engineTaskId: task.engineTaskId,
        taskKey: task.taskKey,
        formKey: task.formKey ?? task.taskKey,
        assigneeId: assignee.value,
        status: 'open',
        decision: null,
        completionKey: null,
        openedAt: this.clock.now(),
        closedAt: null,
        version: 1,
      });
      return 'applied';
    });
  }

  /** A task of the adopted instance that ended before any pass saw it open. */
  private backfillTask(
    tenant: TenantContext,
    request: RequestRecord,
    record: EngineTaskRecord,
  ): Promise<Outcome> {
    const assignee = record.assigneeId === null ? null : parseId(record.assigneeId);
    const closed =
      record.end === null
        ? null
        : statusOnEngineEnd({ status: 'open', assigneeId: '', completionKey: null }, record.end);
    if (assignee === null || !assignee.ok || closed === null) return Promise.resolve('deferred');
    const eventId = this.eventId(tenant, 'task-opened', record.engineTaskId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.surfaceTask, async () => {
      const now = this.clock.now();
      await this.store.insertTask(tenant, {
        id: this.ids.next<'Task'>(),
        requestId: request.id,
        engineTaskId: record.engineTaskId,
        taskKey: record.taskKey,
        formKey: record.formKey ?? record.taskKey,
        assigneeId: assignee.value,
        status: closed.status,
        decision: null,
        completionKey: null,
        openedAt: now,
        closedAt: now,
        version: 1,
      });
      if (closed.incident !== null) {
        await this.recordIncident(tenant, closed.incident, record.engineTaskId, request.id);
      }
      return 'applied';
    });
  }

  private observeEndedTask(
    tenant: TenantContext,
    task: TaskRecord,
    record: EngineTaskRecord,
  ): Promise<Outcome> {
    const eventId = this.eventId(tenant, 'task-ended', task.engineTaskId);
    return this.apply(tenant, eventId, SYNC_HANDLERS.closeTask, async () => {
      const fresh = await this.store.findTask(tenant, task.id);
      const next =
        fresh === null || record.end === null ? null : statusOnEngineEnd(fresh, record.end);
      if (fresh === null || next === null) return 'applied';
      await this.store.updateTask(tenant, fresh.id, fresh.version, {
        status: next.status,
        closedAt: this.clock.now(),
      });
      if (next.incident !== null) {
        await this.recordIncident(tenant, next.incident, fresh.engineTaskId, fresh.requestId);
      }
      return 'applied';
    });
  }

  /** An instance the core did not adopt: removed first (idempotent), then recorded once. */
  private async removeOrphan(
    tenant: TenantContext,
    instanceId: string,
    request: RequestRecord,
  ): Promise<Outcome> {
    await this.engine.deleteInstance(tenant, instanceId, 'phoenix: orphan instance');
    return this.flag(tenant, SYNC_HANDLERS.flagOrphan, 'orphan-instance', instanceId, request.id);
  }

  private flag(
    tenant: TenantContext,
    handler: string,
    kind: IncidentKind,
    engineRef: string,
    requestId: string | null,
  ): Promise<Outcome> {
    return this.apply(tenant, this.eventId(tenant, kind, engineRef), handler, async () => {
      await this.recordIncident(tenant, kind, engineRef, requestId);
      return 'applied';
    });
  }

  /**
   * One observation, one unit: the inbox row and the change commit together. A repeated
   * observation finds its inbox row and changes nothing; a `deferred` one rolls back so the
   * next pass sees it again.
   */
  private async apply(
    tenant: TenantContext,
    eventId: string,
    handler: string,
    work: () => Promise<'applied' | 'deferred'>,
  ): Promise<Outcome> {
    const result = await this.unitOfWork.run(tenant, async () => {
      const fresh = await this.store.recordInInbox(tenant, eventId, handler, this.clock.now());
      if (!fresh) return ok<Outcome>('duplicate');
      const outcome = await work();
      return outcome === 'deferred' ? err('deferred' as const) : ok<Outcome>(outcome);
    });
    return result.ok ? result.value : 'deferred';
  }

  private recordIncident(
    tenant: TenantContext,
    kind: IncidentKind,
    engineRef: string,
    requestId: string | null,
  ): Promise<void> {
    return this.store.recordIncident(tenant, {
      id: this.ids.next<'Incident'>(),
      kind,
      engineRef,
      requestId,
      detectedAt: this.clock.now(),
    });
  }

  private eventId(tenant: TenantContext, kind: string, engineRef: string): string {
    return this.hasher.derivedId([tenant.tenantId, kind, engineRef]);
  }

  private async read<T>(tenant: TenantContext, work: () => Promise<T>): Promise<T> {
    const result = await this.unitOfWork.run(tenant, async () => ok(await work()), {
      readOnly: true,
    });
    if (!result.ok) throw new Error('unreachable: a read unit returned err');
    return result.value;
  }
}
