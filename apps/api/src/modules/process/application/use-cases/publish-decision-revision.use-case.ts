import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_DEFINITIONS_PUBLISH } from '../../contracts/permissions';
import { PROCESS_DECISION_PUBLISHED } from '../../domain/audit-actions';
import { checkDmn } from '../../domain/dmn-guard';
import type { EngineCommands } from '../engine-commands';
import type { DmnRefusal } from '../failures';
import type { BridgeHashing } from '../ports/bridge-hashing';
import type { ProcessRepository } from '../process.repository';

export interface PublishDecisionRevisionInput {
  /** The DMN decision id of the table. */
  readonly decisionKey: string;
  readonly dmnXml: string;
}

export interface PublishedDecision {
  readonly id: Id<'DecisionRevision'>;
  readonly revision: number;
}

/**
 * Publishes a DMN decision table as the next immutable revision of its key in the tenant
 * (slice 2.7; ADR-0007 V1) and queues its deployment to the engine under the tenant. A process's
 * decision task runs the latest revision of the key, so publishing changes the rule of every
 * process that uses it from its next decision on: the same permission as publishing a process
 * (owner decision D7). Only a plain table of literals passes the intake check (dmn-guard.ts).
 */
export class PublishDecisionRevision extends UseCase<
  PublishDecisionRevisionInput,
  PublishedDecision,
  DmnRefusal
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.publish-decision-revision',
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

  protected async handle(
    context: CallContext,
    input: PublishDecisionRevisionInput,
  ): Promise<Result<PublishedDecision, DmnRefusal>> {
    const checked = checkDmn(input.dmnXml, input.decisionKey);
    if (!checked.ok) return checked;
    const contentHash = this.hashing.contentHash(input.dmnXml);
    const id = this.ids.next<'DecisionRevision'>();
    const { tenant } = context;

    return this.unitOfWork.run<PublishedDecision, DmnRefusal>(tenant, async () => {
      // Two publishes of one key at once: the second is a stale write (409 conflict.stale).
      const revision =
        (await this.repository.latestDecisionRevisionNumber(tenant, input.decisionKey)) + 1;
      await this.repository.insertDecisionRevision(
        tenant,
        { id, decisionKey: input.decisionKey, revision, dmnXml: input.dmnXml, contentHash },
        this.clock.now(),
      );
      await this.commands.deployDecision(context, { id });
      await this.audit.record(
        context,
        PROCESS_DECISION_PUBLISHED.entry(id, { after: { revision } }),
      );
      return ok({ id, revision });
    });
  }
}
