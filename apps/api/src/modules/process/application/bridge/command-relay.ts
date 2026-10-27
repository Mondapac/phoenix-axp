import { Logger } from '@nestjs/common';
import { ok, parseId } from '@phoenix/shared-kernel';
import type {
  CallContext,
  Clock,
  Id,
  IdGenerator,
  JsonObject,
  TenantContext,
} from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_TASK_COMPLETION_SUPERSEDED } from '../../domain/audit-actions';
import {
  COMMAND_LEASE_MS,
  invalidVariable,
  RELAY_BATCH_SIZE,
  retryAfter,
  type EngineVariables,
} from '../../domain/engine-command';
import { checkBpmn } from '../../domain/bpmn-guard';
import type { IncidentKind } from '../../domain/incident';
import { adoptionOf } from '../../domain/instance';
import { statusOnEngineEnd, type EngineTaskEnd } from '../../domain/task';
import { deadlinePassed } from '../../domain/task-access';
import { OUTCOME_VARIABLE, outcomeOf } from '../../domain/task-settings';
import type { EngineCommands } from '../engine-commands';
import {
  EngineRefusedError,
  EngineTenantMismatchError,
  EngineUnavailableError,
  type EngineDeployment,
  type EngineInstance,
  type ProcessEngine,
} from '../ports/process-engine';
import type { CommandRecord, ProcessRepository, RevisionRecord } from '../process.repository';

export interface RelayPass {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly refused: number;
}

/** The reason Flowable records on an instance the core removed. */
export const ORPHAN_DELETE_REASON = 'phoenix: orphan instance';

/**
 * Core -> engine (ADR-0005 decision 3; ADR-0020 decision 7): relays `process.engine_command`
 * at least once, never calling the engine inside a transaction. Per command, three short steps:
 *
 *   1. claim: one unit, a compare-and-set on `attempts` that takes a lease;
 *   2. call:  the engine, outside any unit;
 *   3. ack:   one unit that applies the outcome and marks the command published.
 *
 * A crash between 2 and 3 leaves the command claimed until its lease runs out; then a pass
 * claims it again and repeats the call, which each kind makes harmless (see `CommandKind`). An
 * unreachable engine releases the command with a back-off; a refusal ends it with a
 * `command-refused` incident.
 */
export class CommandRelay {
  readonly #logger = new Logger('CommandRelay');

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly engine: ProcessEngine,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly audit: AuditWriter,
  ) {}

  async runOnce(context: CallContext): Promise<RelayPass> {
    const { tenant } = context;
    const claimed = await this.unitOfWork.run<CommandRecord[], never>(tenant, async () => {
      const now = this.clock.now();
      const leaseUntil = now.add({ milliseconds: COMMAND_LEASE_MS });
      const won: CommandRecord[] = [];
      for (const command of await this.repository.dueCommands(tenant, now, RELAY_BATCH_SIZE)) {
        if (await this.repository.claimCommand(tenant, command, leaseUntil)) {
          won.push({ ...command, attempts: command.attempts + 1 });
        }
      }
      return ok(won);
    });
    const pass = { claimed: 0, delivered: 0, retried: 0, refused: 0 };
    if (!claimed.ok) return pass;
    pass.claimed = claimed.value.length;

    for (const command of claimed.value) {
      try {
        await this.deliver(context, command);
        pass.delivered += 1;
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          pass.retried += 1;
          await this.release(tenant, command, `engine.${error.reason}`);
        } else if (
          error instanceof EngineRefusedError ||
          error instanceof EngineTenantMismatchError
        ) {
          pass.refused += 1;
          const code =
            error instanceof EngineRefusedError
              ? `engine.${error.reason}`
              : 'engine.tenant-mismatch';
          this.#logger.warn({
            msg: 'process.command.refused',
            tenantId: tenant.tenantId,
            commandId: command.id,
            correlationId: command.correlationId,
            kind: command.kind,
            code,
          });
          await this.refuse(tenant, command, code);
        } else {
          // A defect of the core: given back with a back-off, and the job sees the error.
          await this.release(tenant, command, 'relay.failed');
          throw error;
        }
      }
    }
    return pass;
  }

  private deliver(context: CallContext, command: CommandRecord): Promise<void> {
    switch (command.kind) {
      case 'deploy-revision':
        return this.deployRevision(context.tenant, command);
      case 'start-instance':
        return this.startInstance(context, command);
      case 'complete-task':
        return this.completeTask(context, command);
      case 'delete-orphan':
        return this.deleteOrphan(context.tenant, command);
    }
  }

  private async deployRevision(tenant: TenantContext, command: CommandRecord): Promise<void> {
    const revision = await this.read(tenant, () =>
      this.repository.findRevision(tenant, command.subjectId),
    );
    if (revision === null) throw new EngineRefusedError('not-deployed');
    await this.engine.deployRevision(tenant, deploymentOf(revision));
    await this.ack(tenant, command);
  }

  /**
   * Starts the instance once (PoC 3 R3): an earlier attempt may have started it and died
   * before its ack, so the business key is looked up first. The first engine instance recorded
   * in the core wins; any other with the key is an orphan, removed by its own command.
   */
  private async startInstance(context: CallContext, command: CommandRecord): Promise<void> {
    const { tenant } = context;
    const found = await this.read(tenant, async () => {
      const instance = await this.repository.findInstance(tenant, command.subjectId);
      const revision =
        instance === null ? null : await this.repository.findRevision(tenant, instance.revisionId);
      return instance === null || revision === null ? null : { instance, revision };
    });
    if (found === null) throw new EngineRefusedError('not-deployed');
    const { instance, revision } = found;

    let engineInstances: EngineInstance[] = [];
    if (instance.status === 'starting') {
      await this.engine.deployRevision(tenant, deploymentOf(revision));
      engineInstances = await this.engine.findInstancesByBusinessKey(tenant, instance.id);
      if (engineInstances.length === 0) {
        engineInstances = [
          await this.engine.startInstance(tenant, {
            processKey: revision.processKey,
            revisionId: revision.id,
            businessKey: instance.id,
            variables: variablesOf(command.payload),
          }),
        ];
      }
    }

    const orphans = await this.unitOfWork.run<string[], never>(tenant, async () => {
      const removed: string[] = [];
      // Oldest first; an instance deleted already (an orphan removed before) is never adopted.
      for (const engineInstance of engineInstances.filter((candidate) => !candidate.deleted)) {
        const recorded = await this.repository.adoptEngineInstance(
          tenant,
          instance.id,
          engineInstance.engineInstanceId,
        );
        if (adoptionOf(recorded, engineInstance.engineInstanceId) !== 'orphan') continue;
        removed.push(engineInstance.engineInstanceId);
        await this.incident(
          tenant,
          'orphan-instance',
          engineInstance.engineInstanceId,
          instance.id,
        );
        await this.commands.deleteOrphan(
          tenant,
          context.correlationId,
          instance.id,
          engineInstance.engineInstanceId,
        );
      }
      await this.repository.ackCommand(tenant, command.id, this.clock.now());
      return ok(removed);
    });
    if (orphans.ok && orphans.value.length > 0) {
      this.#logger.warn({
        msg: 'process.instance.orphans',
        tenantId: tenant.tenantId,
        instanceId: instance.id,
        correlationId: command.correlationId,
        orphans: orphans.value.length,
      });
    }
  }

  /**
   * Completes the engine task with the command id as completion key (PoC 3 R4). When the task
   * is gone, its history tells the core's own earlier completion from a deadline that won or a
   * completion made outside the core. A decision that has not reached the engine when the
   * task's deadline passes never does: the deadline wins (owner decision on PoC 3 R7).
   */
  private async completeTask(context: CallContext, command: CommandRecord): Promise<void> {
    const { tenant } = context;
    const task = await this.read(tenant, () => this.repository.findTask(tenant, command.subjectId));
    let end: EngineTaskEnd | null = null;
    if (task !== null && task.status === 'completing' && task.completionKey === command.id) {
      if (deadlinePassed(task, this.clock.now())) return this.supersede(context, command);
      const outcome = await this.engine.completeTask(
        tenant,
        task.engineTaskId,
        engineVariablesOf(command.payload),
        command.id,
      );
      end =
        outcome === 'completed'
          ? { kind: 'completed', completionKey: command.id }
          : ((await this.engine.findTask(tenant, task.engineTaskId))?.end ?? null);
    }

    await this.unitOfWork.run<void, never>(tenant, async () => {
      const fresh = await this.repository.findTask(tenant, command.subjectId);
      const next = fresh === null || end === null ? null : statusOnEngineEnd(fresh, end);
      if (fresh !== null && next !== null) {
        const now = this.clock.now();
        if (await this.repository.closeTask(tenant, fresh, next.status, now)) {
          if (next.incident !== null) {
            await this.incident(tenant, next.incident, fresh.engineTaskId, fresh.instanceId);
          }
        }
      }
      // A task the sync closed meanwhile needs nothing more: the command is done.
      await this.repository.ackCommand(tenant, command.id, this.clock.now());
      return ok(undefined);
    });
  }

  /**
   * The deadline passed before the decision reached the engine: the task escalates as if the
   * person had not decided, the decision stays on the row (`outcome`) labelled superseded in the
   * audit log, and the command ends without reaching the engine.
   */
  private async supersede(context: CallContext, command: CommandRecord): Promise<void> {
    const { tenant } = context;
    await this.unitOfWork.run<void, never>(tenant, async () => {
      const now = this.clock.now();
      const fresh = await this.repository.findTask(tenant, command.subjectId);
      if (
        fresh !== null &&
        fresh.status === 'completing' &&
        fresh.completionKey === command.id &&
        fresh.escalationRoleId !== null &&
        (await this.repository.escalateTask(tenant, fresh, now))
      ) {
        await this.incident(tenant, 'completion-superseded', fresh.engineTaskId, fresh.instanceId);
        await this.audit.record(
          context,
          PROCESS_TASK_COMPLETION_SUPERSEDED.entry(fresh.id, {
            after: { role: fresh.escalationRoleId },
          }),
        );
      }
      await this.repository.killCommand(tenant, command.id, now, 'task.superseded');
      return ok(undefined);
    });
  }

  private async deleteOrphan(tenant: TenantContext, command: CommandRecord): Promise<void> {
    const engineInstanceId = command.payload.engineInstanceId;
    if (typeof engineInstanceId !== 'string') throw new EngineRefusedError('client-error');
    await this.engine.deleteInstance(tenant, engineInstanceId, ORPHAN_DELETE_REASON);
    await this.ack(tenant, command);
  }

  private async ack(tenant: TenantContext, command: CommandRecord): Promise<void> {
    await this.unitOfWork.run<void, never>(tenant, async () => {
      await this.repository.ackCommand(tenant, command.id, this.clock.now());
      return ok(undefined);
    });
  }

  private async release(tenant: TenantContext, command: CommandRecord, code: string) {
    await this.unitOfWork.run<void, never>(tenant, async () => {
      const retryAt = retryAfter(this.clock.now(), command.attempts);
      await this.repository.releaseCommand(tenant, command, retryAt, code);
      return ok(undefined);
    });
  }

  private async refuse(tenant: TenantContext, command: CommandRecord, code: string) {
    await this.unitOfWork.run<void, never>(tenant, async () => {
      await this.repository.killCommand(tenant, command.id, this.clock.now(), code);
      const instance =
        command.kind === 'start-instance' ? parseId<'ProcessInstance'>(command.subjectId) : null;
      await this.incident(
        tenant,
        'command-refused',
        command.id,
        instance?.ok ? instance.value : null,
      );
      return ok(undefined);
    });
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

  private async read<T>(tenant: TenantContext, work: () => Promise<T>): Promise<T> {
    const result = await this.unitOfWork.run(tenant, async () => ok(await work()), {
      readOnly: true,
    });
    if (!result.ok) return Promise.reject(new Error('unreachable: a read unit returned err'));
    return result.value;
  }
}

/**
 * What a completion sends the engine: the payload's variables and, when the person picked one,
 * the outcome as the core's own `phoenixOutcome`, checked again like the variables.
 */
function engineVariablesOf(payload: JsonObject): EngineVariables {
  const variables = variablesOf(payload);
  if (payload.outcome === undefined) return variables;
  const outcome = outcomeOf(payload.outcome);
  if (outcome === null) throw new EngineRefusedError('client-error');
  return { ...variables, [OUTCOME_VARIABLE]: outcome };
}

/** The variables of a command payload, checked again: the row is data, not trust. */
function variablesOf(payload: JsonObject): EngineVariables {
  const variables = payload.variables;
  if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) return {};
  if (invalidVariable(variables as Readonly<Record<string, unknown>>) !== null) {
    throw new EngineRefusedError('client-error');
  }
  return variables as EngineVariables;
}

/**
 * What the engine deploys, checked again: a revision stored under an earlier, weaker intake
 * check never reaches the shared engine (security review of slice 2.2).
 */
function deploymentOf(revision: RevisionRecord): EngineDeployment {
  if (!checkBpmn(revision.bpmnXml, revision.processKey).ok) {
    throw new EngineRefusedError('model-refused');
  }
  return { processKey: revision.processKey, revisionId: revision.id, bpmnXml: revision.bpmnXml };
}
