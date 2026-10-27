import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_SUBMISSION_READ } from '../../contracts/permissions';
import type { FormRepository } from '../form.repository';
import { accessByRevision, viewsOf, type SubmissionView, type VisibleField } from '../inbox';
import type { SubmissionAccess } from '../submission-access';
import type { SubmissionRepository } from '../submission.repository';

export type SubmissionNotFound = { readonly code: 'forms.submission.not-found' };
export const SUBMISSION_NOT_FOUND: SubmissionNotFound = Object.freeze({
  code: 'forms.submission.not-found',
});

export interface FormSubmissionDetail {
  readonly submission: SubmissionView;
  readonly fields: readonly VisibleField[];
}

/**
 * One submission of a form inbox, with the answers the reader's field modes show (ADR-0024).
 * Outside the reader's site, definition or read grant it answers as not found.
 */
export class ViewFormSubmission extends UseCase<
  { readonly submissionId: Id<'FormSubmission'> },
  FormSubmissionDetail,
  SubmissionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.view-form-submission',
    rule: { kind: 'permissions', allOf: [FORMS_SUBMISSION_READ.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly submissions: SubmissionRepository,
    private readonly access: SubmissionAccess,
    private readonly subjectKeys: SubjectKeyService,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { readonly submissionId: Id<'FormSubmission'> },
  ): Promise<Result<FormSubmissionDetail, SubmissionNotFound>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const record = await this.submissions.find(tenant, input.submissionId);
        if (record === null) return ok(null);
        const form = await this.forms.find(tenant, record.formId);
        if (form === null) return ok(null);
        const current =
          form.publishedRevisionId === null
            ? null
            : ((await this.forms.findRevision(tenant, form.publishedRevisionId))?.fields ?? null);
        const revisions = await this.forms.fieldsOfRevisions(tenant, [record.revisionId]);
        return ok({ record, form, current, revisions });
      },
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return err(SUBMISSION_NOT_FOUND);
    const { record, form, current, revisions } = read.value;
    const access = await accessByRevision(this.access, context, form, revisions, current);
    if (access.get(record.revisionId)?.canRead !== true) return err(SUBMISSION_NOT_FOUND);
    const keys = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.subjectKeys.wrappedKeys(tenant, [record.id])),
      { readOnly: true },
    );
    const { views, fields } = viewsOf(
      context,
      this.subjectKeys,
      [record],
      keys.ok ? keys.value : new Map(),
      revisions,
      access,
    );
    const [submission] = views;
    return submission === undefined ? err(SUBMISSION_NOT_FOUND) : ok({ submission, fields });
  }
}
