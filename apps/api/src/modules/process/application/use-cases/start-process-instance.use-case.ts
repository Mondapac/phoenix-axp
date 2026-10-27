import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { invalidVariable, type EngineVariables } from '../../domain/engine-command';
import type { EngineCommands } from '../engine-commands';
import {
  REVISION_NOT_FOUND,
  type InvalidVariable,
  type RevisionNotFound,
} from '../failures';
import type { ProcessRepository } from '../process.repository';

export interface StartProcessInstanceInput {
  readonly revisionId: Id<'ProcessRevision'>;
  /** Ids, codes and numbers for the model (ADR-0005 decision 7). */
  readonly variables: EngineVariables;
}

/**
 * Starts a run of exactly one process revision (ADR-0007 V3): the core instance and its start
 * command commit together, and the relay starts the engine instance with the core id as its
 * business key (PoC 3 R3). `system`: called by the module's own subscribers (a form submission,
 * slice 2.6), never from HTTP.
 */
export class StartProcessInstance extends UseCase<
  StartProcessInstanceInput,
  { id: Id<'ProcessInstance'> },
  RevisionNotFound | InvalidVariable
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.start-process-instance',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: StartProcessInstanceInput,
  ): Promise<Result<{ id: Id<'ProcessInstance'> }, RevisionNotFound | InvalidVariable>> {
    const invalid = invalidVariable(input.variables);
    if (invalid !== null) {
      return Promise.resolve(err({ code: 'process.variable.invalid', field: invalid }));
    }
    const id = this.ids.next<'ProcessInstance'>();
    const { tenant } = context;
    return this.unitOfWork.run<{ id: Id<'ProcessInstance'> }, RevisionNotFound>(
      tenant,
      async () => {
        const revision = await this.repository.findRevision(tenant, input.revisionId);
        if (revision === null) return err(REVISION_NOT_FOUND);
        await this.repository.insertInstance(
          tenant,
          { id, revisionId: revision.id },
          this.clock.now(),
        );
        await this.commands.startInstance(context, id, revision.id, input.variables);
        return ok({ id });
      },
    );
  }
}
