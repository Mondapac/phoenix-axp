import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_DEFINITIONS_PUBLISH } from '../../contracts/permissions';
import { PROCESS_REVISION_PUBLISHED } from '../../domain/audit-actions';
import { checkBpmn } from '../../domain/bpmn-guard';
import type { EngineCommands } from '../engine-commands';
import type { BpmnRefusal } from '../failures';
import type { BridgeHashing } from '../ports/bridge-hashing';
import type { ProcessRepository } from '../process.repository';

export interface PublishProcessRevisionInput {
  /** The BPMN process id of the model. */
  readonly processKey: string;
  readonly bpmnXml: string;
}

export interface PublishedRevision {
  readonly id: Id<'ProcessRevision'>;
  readonly revision: number;
}

/**
 * Publishes a BPMN model as the next immutable revision of its process (ADR-0007 V1) and queues
 * its deployment to the engine under the tenant (ADR-0020 decision 6). Publishing is its own
 * permission, apart from designing (owner decision D7). Only plain BPMN passes the intake check:
 * the engine is shared by every tenant.
 */
export class PublishProcessRevision extends UseCase<
  PublishProcessRevisionInput,
  PublishedRevision,
  BpmnRefusal
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.publish-process-revision',
    rule: { kind: 'permissions', allOf: [PROCESS_DEFINITIONS_PUBLISH.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly hashing: BridgeHashing,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: PublishProcessRevisionInput,
  ): Promise<Result<PublishedRevision, BpmnRefusal>> {
    const checked = checkBpmn(input.bpmnXml, input.processKey);
    if (!checked.ok) return Promise.resolve(checked);
    const contentHash = this.hashing.contentHash(input.bpmnXml);
    const id = this.ids.next<'ProcessRevision'>();
    const { tenant } = context;

    return this.unitOfWork.run<PublishedRevision, BpmnRefusal>(tenant, async () => {
      // Two publishes of one key at once: the unique (tenant, key, revision) refuses the second
      // as a conflict, and the caller tries again.
      const revision = (await this.repository.latestRevisionNumber(tenant, input.processKey)) + 1;
      await this.repository.insertRevision(
        tenant,
        { id, processKey: input.processKey, revision, bpmnXml: input.bpmnXml, contentHash },
        this.clock.now(),
      );
      await this.commands.deployRevision(context, { id });
      await this.audit.record(context, PROCESS_REVISION_PUBLISHED.entry(id, { after: { revision } }));
      return ok({ id, revision });
    });
  }
}
