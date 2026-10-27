import type { CallContext, Clock, Id, IdGenerator, TenantContext } from '@phoenix/shared-kernel';
import type { EngineVariables } from '../domain/engine-command';
import { canRequestCompletion } from '../domain/task';
import type { ProcessRepository, RevisionRecord, TaskRecord } from './process.repository';

/**
 * Writes the core's commands to the engine (ADR-0005 decision 3), each in the open unit of the
 * state change it belongs to, so the change and its command commit together. The relay sends
 * them later, outside any unit. Every payload holds ids, codes and numbers only.
 */
export class EngineCommands {
  constructor(
    private readonly repository: ProcessRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Deploys a published revision to the tenant. */
  deployRevision(context: CallContext, revision: Pick<RevisionRecord, 'id'>): Promise<void> {
    return this.write(context.tenant, context.correlationId, {
      kind: 'deploy-revision',
      subjectId: revision.id,
      payload: { revisionId: revision.id },
    });
  }

  /** Starts the engine instance of a core instance; its id is the business key. */
  startInstance(
    context: CallContext,
    instanceId: Id<'ProcessInstance'>,
    revisionId: Id<'ProcessRevision'>,
    variables: EngineVariables,
  ): Promise<void> {
    return this.write(context.tenant, context.correlationId, {
      kind: 'start-instance',
      subjectId: instanceId,
      payload: { revisionId, variables: { ...variables } },
    });
  }

  /**
   * Asks the engine to complete an open task (slice 2.3 decides who may): the task moves to
   * `completing` with the command id as its completion key (PoC 3 R4). False when the task is
   * not open or changed meanwhile; nothing is written then.
   */
  async completeTask(
    context: CallContext,
    task: TaskRecord,
    variables: EngineVariables,
  ): Promise<boolean> {
    if (!canRequestCompletion(task)) return false;
    const id = this.ids.next<'EngineCommand'>();
    if (!(await this.repository.markCompleting(context.tenant, task, id))) return false;
    await this.write(
      context.tenant,
      context.correlationId,
      {
        kind: 'complete-task',
        subjectId: task.id,
        payload: { engineTaskId: task.engineTaskId, variables: { ...variables } },
      },
      id,
    );
    return true;
  }

  /** Removes an engine instance the core did not adopt (ADR-0020 decision 9). */
  deleteOrphan(
    tenant: TenantContext,
    correlationId: string,
    instanceId: Id<'ProcessInstance'>,
    engineInstanceId: string,
  ): Promise<void> {
    return this.write(tenant, correlationId, {
      kind: 'delete-orphan',
      subjectId: instanceId,
      payload: { engineInstanceId },
    });
  }

  private write(
    tenant: TenantContext,
    correlationId: string,
    command: Omit<Parameters<ProcessRepository['insertCommand']>[1], 'id' | 'correlationId'>,
    id: Id<'EngineCommand'> = this.ids.next<'EngineCommand'>(),
  ): Promise<void> {
    return this.repository.insertCommand(
      tenant,
      { ...command, id, correlationId },
      this.clock.now(),
    );
  }
}
