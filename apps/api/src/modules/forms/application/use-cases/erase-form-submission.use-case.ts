import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import {
  resolveFieldAccess,
  UseCase,
  type AccessDeclaration,
  type FieldRuleReader,
  type SiteAncestryReader,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_SUBMISSION_ERASE } from '../../contracts/permissions';
import { FORM_SUBMISSION_ERASED } from '../../domain/audit-actions';
import type { SubmissionRepository } from '../submission.repository';
import { SUBMISSION_NOT_FOUND, type SubmissionNotFound } from './view-form-submission.use-case';

export interface EraseFormSubmissionInput {
  readonly submissionId: Id<'FormSubmission'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
}

export type AlreadyErased = { readonly code: 'forms.submission.already-erased' };

/**
 * Erases the personal data of one submission on request (owner decision D5: erasure on
 * request under either retention): its subject key is destroyed, so its answers can never be
 * read again; the submission keeps its provenance and status for the tracking page. Needs
 * `forms.submission.erase` on the form's site and definition.
 */
export class EraseFormSubmission extends UseCase<
  EraseFormSubmissionInput,
  void,
  SubmissionNotFound | AlreadyErased
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.erase-form-submission',
    rule: { kind: 'permissions', allOf: [FORMS_SUBMISSION_ERASE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly submissions: SubmissionRepository,
    private readonly rules: FieldRuleReader,
    private readonly sites: SiteAncestryReader,
    private readonly subjectKeys: SubjectKeyService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: EraseFormSubmissionInput,
  ): Promise<Result<void, SubmissionNotFound | AlreadyErased>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.submissions.find(tenant, input.submissionId)),
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return err(SUBMISSION_NOT_FOUND);
    const found = read.value;
    // Tenant, site and definition from the actor's grants (ADR-0024 decision 2); no field.
    const access = await resolveFieldAccess(this.rules, this.sites, context, found.siteId, {
      definitionId: found.formId as string as Id<'Definition'>,
      operations: { read: FORMS_SUBMISSION_ERASE.key, write: FORMS_SUBMISSION_ERASE.key },
      fields: [],
    });
    if (!access.canWrite) return err(SUBMISSION_NOT_FOUND);

    return this.unitOfWork.run<void, SubmissionNotFound | AlreadyErased>(tenant, async () => {
      const record = await this.submissions.find(tenant, input.submissionId);
      if (record === null) return err(SUBMISSION_NOT_FOUND);
      if (record.erasedAt !== null)
        return err({ code: 'forms.submission.already-erased' } as const);
      const at = this.clock.now();
      if (!(await this.submissions.markErased(tenant, record.id, input.version, at))) {
        throw new StaleAggregateError('forms.submission', record.id);
      }
      await this.subjectKeys.destroy(tenant, record.id, at);
      await this.audit.record(
        context,
        FORM_SUBMISSION_ERASED.entry(record.id, {
          after: { formId: record.formId, reason: 'request' },
        }),
      );
      return ok(undefined);
    });
  }
}
