import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type SiteAncestryReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { EventDelivery } from '../../../../platform/events/event-delivery';
import type { HandledOnce, UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { invalidVariable, type EngineVariables } from '../../domain/engine-command';
import type { EngineCommands } from '../engine-commands';
import type { InvalidVariable } from '../failures';
import type { ProcessRepository } from '../process.repository';

/** A stored form submission, as forms.submission-received.v1 reports it: ids only. */
export interface ReceivedSubmission {
  readonly submissionId: Id<'FormSubmission'>;
  readonly formId: Id<'Form'>;
  readonly formRevisionId: Id<'FormRevision'>;
  readonly siteId: Id<'Site'>;
}

export interface StartProcessFromSubmissionInput {
  readonly submission: ReceivedSubmission;
  readonly delivery: EventDelivery;
}

/** What the handler did: started an instance, or why it did not. */
export type SubmissionStart =
  | { readonly started: Id<'ProcessInstance'> }
  | { readonly skipped: 'no-process' | 'already-started' | 'unknown-site' };

/**
 * Starts the process a form starts when one of its submissions is stored (slice 2.6; phase 2
 * review: "a submission starts the process"). The process is the newest revision of the process
 * key that claimed the form as its start form, if that revision still binds it; a form no
 * process starts is not an error. The run belongs to the submission's site (checked against the
 * tenant's sites first), records the submission (one instance per submission), and receives
 * ids only (ADR-0005 decision 7): the submission, the form and the revision it was made under.
 * The inbox row, the instance and its start command commit together (UnitOfWork.runOnce).
 */
export class StartProcessFromSubmission extends UseCase<
  StartProcessFromSubmissionInput,
  HandledOnce<SubmissionStart>,
  InvalidVariable
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.start-process-from-submission',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly sites: SiteAncestryReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: StartProcessFromSubmissionInput,
  ): Promise<Result<HandledOnce<SubmissionStart>, InvalidVariable>> {
    const { submission, delivery } = input;
    const variables: EngineVariables = {
      submissionId: submission.submissionId,
      formId: submission.formId,
      formRevisionId: submission.formRevisionId,
    };
    const invalid = invalidVariable(variables);
    if (invalid !== null) return err({ code: 'process.variable.invalid', field: invalid });
    // The port reads in a unit of its own: before runOnce, never inside it.
    const siteKnown = await this.sites.siteExists(context, submission.siteId);
    const { tenant } = context;

    return this.unitOfWork.runOnce<SubmissionStart, never>(tenant, delivery, async () => {
      if (!siteKnown) return ok({ skipped: 'unknown-site' });
      const revision = await this.repository.startingRevision(tenant, submission.formId);
      if (revision === null) return ok({ skipped: 'no-process' });
      if (await this.repository.hasInstanceFromSubmission(tenant, submission.submissionId)) {
        return ok({ skipped: 'already-started' });
      }
      const id = this.ids.next<'ProcessInstance'>();
      await this.repository.insertInstance(
        tenant,
        {
          id,
          revisionId: revision.id,
          siteId: submission.siteId,
          submissionId: submission.submissionId,
        },
        this.clock.now(),
      );
      await this.commands.startInstance(context, id, revision.id, variables);
      return ok({ started: id });
    });
  }
}
