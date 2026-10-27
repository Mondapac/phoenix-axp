import { ok } from '@phoenix/shared-kernel';
import type { Clock, IdGenerator, TenantContext } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { requestSubmitted, taskCompletionRequested } from '../../domain/events';
import { adoptInstance } from '../../domain/request';
import { isDecision, statusOnEngineEnd, type EngineTaskEnd } from '../../domain/task';
import { EngineUnavailableError, type ProcessEngine } from '../ports/process-engine';
import type { ClaimedCommand, ProcessStore } from '../ports/process-store';

export interface RelayOptions {
  /** How long a claim holds a row. Must exceed the engine call timeout, with margin. */
  readonly leaseMs: number;
  /** Rows per claim and tenant. */
  readonly batchSize: number;
  /** The pause before a row whose engine call failed is tried again. */
  readonly retryAfterMs: number;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = {
  leaseMs: 60_000,
  batchSize: 20,
  retryAfterMs: 5_000,
};

export interface RelayPass {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
}

/**
 * Core -> engine: relays `process.outbox` commands to the engine (ADR-0005 decision 3), at
 * least once, with each command made idempotent on the engine side.
 *
 * Three short steps per row, never an engine call inside a transaction (CLAUDE.md: no HTTP in
 * a unit of work):
 *   1. claim  - one unit: compare-and-set `attempts` and a lease on due rows;
 *   2. call   - the engine, outside any unit;
 *   3. ack    - one unit: apply the outcome to the core rows and publish the outbox row.
 * A crash between 2 and 3 leaves the row claimed; when the lease runs out another pass claims
 * it again and the engine call is repeated. That repeat is harmless because:
 *   - a start first looks for an instance with the request id as business key and adopts it;
 *   - a completion carries the outbox event id as completion key; a task that is gone is read
 *     from history and matched against that key.
 * Deviation from ADR-0006 decision 4 (`FOR UPDATE SKIP LOCKED` around the whole delivery): a
 * row lock cannot be held across an HTTP call, so the lock is replaced by a lease (report).
 */
export class CommandRelay {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: ProcessStore,
    private readonly engine: ProcessEngine,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly options: RelayOptions = DEFAULT_RELAY_OPTIONS,
  ) {}

  async runOnce(tenant: TenantContext): Promise<RelayPass> {
    const now = this.clock.now();
    const claimed = await this.unitOfWork.run(tenant, async () =>
      ok(
        await this.store.claimOutbox(
          tenant,
          now,
          now.add({ milliseconds: this.options.leaseMs }),
          this.options.batchSize,
        ),
      ),
    );
    if (!claimed.ok) return { claimed: 0, delivered: 0, retried: 0 };

    let delivered = 0;
    let retried = 0;
    for (const command of claimed.value) {
      try {
        await this.deliver(tenant, command);
        delivered += 1;
      } catch (error) {
        if (!(error instanceof EngineUnavailableError)) throw error;
        retried += 1;
        const retryAt = this.clock.now().add({ milliseconds: this.options.retryAfterMs });
        await this.unitOfWork.run(tenant, async () => {
          await this.store.releaseOutbox(tenant, command, retryAt, `engine.${error.reason}`);
          return ok(undefined);
        });
      }
    }
    return { claimed: claimed.value.length, delivered, retried };
  }

  private async deliver(tenant: TenantContext, command: ClaimedCommand): Promise<void> {
    switch (command.type) {
      case requestSubmitted.type:
        return this.startInstance(tenant, command);
      case taskCompletionRequested.type:
        return this.completeTask(tenant, command);
      default:
        throw new Error(`The relay has no route for ${command.type}`);
    }
  }

  /** `process.request-submitted.v1`: start the instance once per request. */
  private async startInstance(tenant: TenantContext, command: ClaimedCommand): Promise<void> {
    const payload = command.payload;
    const requestId = String(payload.requestId);
    const revision = await this.unitOfWork.run(
      tenant,
      async () =>
        ok(await this.store.findProcessRevision(tenant, String(payload.processRevisionId))),
      { readOnly: true },
    );
    if (!revision.ok || revision.value === null) {
      throw new Error('process.request-submitted.v1 names an unknown process revision');
    }
    // Idempotency: an earlier attempt may have started it and crashed before its ack.
    const existing = await this.engine.findInstancesByBusinessKey(tenant, requestId);
    const [instance, ...extra] =
      existing.length > 0
        ? existing
        : [
            await this.engine.startInstance(tenant, {
              processKey: revision.value.processKey,
              revisionId: revision.value.id,
              businessKey: requestId,
              variables: {
                requestId,
                approverId: String(payload.approverId),
                managerId: String(payload.managerId),
                escalateAfter: `PT${Number(payload.escalateAfterSeconds)}S`,
              },
            }),
          ];

    const orphans = extra.map((other) => other.instanceId);
    const acked = await this.unitOfWork.run(tenant, async () => {
      const stored = await this.store.adoptInstance(tenant, requestId, instance!.instanceId);
      if (adoptInstance(stored, instance!.instanceId) === 'orphan') {
        orphans.push(instance!.instanceId); // the sync adopted another instance first
      }
      for (const orphan of orphans)
        await this.incident(tenant, 'orphan-instance', orphan, requestId);
      await this.store.ackOutbox(tenant, command, this.clock.now());
      return ok(orphans);
    });
    // Idempotent cleanup after the ack; if it fails, the sync finds the orphan's tasks again.
    if (acked.ok) {
      for (const orphan of acked.value) {
        await this.engine.deleteInstance(tenant, orphan, 'phoenix: duplicate start');
      }
    }
  }

  /** `process.task-completion-requested.v1`: complete the engine task with our key. */
  private async completeTask(tenant: TenantContext, command: ClaimedCommand): Promise<void> {
    const taskId = String(command.payload.taskId);
    const decision = command.payload.decision;
    const task = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.store.findTask(tenant, taskId)),
      { readOnly: true },
    );
    if (!task.ok) return;
    const current = task.value;

    let end: EngineTaskEnd | null = null;
    if (current !== null && current.status === 'completing' && isDecision(decision)) {
      const outcome = await this.engine.completeTask(
        tenant,
        current.engineTaskId,
        decision,
        command.eventId,
      );
      if (outcome === 'completed') {
        end = { kind: 'completed', completionKey: command.eventId };
      } else {
        // Gone: completed by an earlier attempt of this command, or removed by the timer.
        const record = await this.engine.findTask(tenant, current.engineTaskId);
        end = record?.end ?? null;
      }
    }

    await this.unitOfWork.run(tenant, async () => {
      const fresh = await this.store.findTask(tenant, taskId);
      const next = fresh !== null && end !== null ? statusOnEngineEnd(fresh, end) : null;
      if (fresh !== null && next !== null) {
        await this.store.updateTask(tenant, fresh.id, fresh.version, {
          status: next.status,
          closedAt: this.clock.now(),
        });
        if (next.incident !== null) {
          await this.incident(tenant, next.incident, fresh.engineTaskId, fresh.requestId);
        }
      }
      // A task already closed by the sync needs nothing more: the command is done.
      await this.store.ackOutbox(tenant, command, this.clock.now());
      return ok(undefined);
    });
  }

  private incident(
    tenant: TenantContext,
    kind: Parameters<ProcessStore['recordIncident']>[1]['kind'],
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
}
