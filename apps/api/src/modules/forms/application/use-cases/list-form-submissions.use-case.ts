import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_SUBMISSION_READ } from '../../contracts/permissions';
import { FORM_NOT_FOUND, type FormNotFound } from '../failures';
import type { FormRepository } from '../form.repository';
import { accessByRevision, viewsOf, type SubmissionView, type VisibleField } from '../inbox';
import type { SubmissionAccess } from '../submission-access';
import type { InboxCursor, SubmissionRecord, SubmissionRepository } from '../submission.repository';

/** The position after which a page starts, as the controller parses it. */
export type { InboxCursor };

export interface ListFormSubmissionsInput {
  readonly formId: Id<'Form'>;
  /** The position after the last item of the previous page; null for the first page. */
  readonly after: InboxCursor | null;
  readonly limit: number;
}

export interface FormSubmissionsPage {
  readonly items: readonly SubmissionView[];
  /** The visible fields of this page, with their names. */
  readonly fields: readonly VisibleField[];
  /** The cursor of the next page, or null on the last. */
  readonly next: InboxCursor | null;
}

/** The most items of one page. */
export const MAX_INBOX_PAGE = 100;

/**
 * One page of a form inbox, newest first (phase 2 review 2.5, "صندوق فرم"). The reader needs
 * `forms.submission.read` on the form's site and definition; each answer is shown only where
 * the reader's field mode lets them see it (ADR-0024). A form the reader cannot read answers
 * as one that does not exist.
 */
export class ListFormSubmissions extends UseCase<
  ListFormSubmissionsInput,
  FormSubmissionsPage,
  FormNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.list-form-submissions',
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
    input: ListFormSubmissionsInput,
  ): Promise<Result<FormSubmissionsPage, FormNotFound>> {
    const { tenant } = context;
    const limit = Math.min(Math.max(1, Math.trunc(input.limit)), MAX_INBOX_PAGE);
    // The form, its current fields, the page and the revisions it was written under.
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const form = await this.forms.find(tenant, input.formId);
        if (form === null) return ok(null);
        const current =
          form.publishedRevisionId === null
            ? null
            : ((await this.forms.findRevision(tenant, form.publishedRevisionId))?.fields ?? null);
        const records = await this.submissions.listForForm(tenant, form.id, {
          after: input.after,
          limit,
        });
        const revisions = await this.forms.fieldsOfRevisions(tenant, [
          ...new Set(records.map((record) => record.revisionId)),
        ]);
        return ok({ form, current, records, revisions });
      },
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return err(FORM_NOT_FOUND);
    const { form, current, records, revisions } = read.value;

    // The reader's access, from committed grants, before the answers are read.
    const formWide = await this.access.of(context, form, []);
    if (!formWide.canRead) return err(FORM_NOT_FOUND);
    const access = await accessByRevision(this.access, context, form, revisions, current);
    const readable = records.filter((record) => access.get(record.revisionId)?.canRead === true);
    const keys = await this.#keys(context, readable);
    const { views, fields } = viewsOf(context, this.subjectKeys, readable, keys, revisions, access);
    const last = records.at(-1);
    return ok({
      items: views,
      fields,
      next:
        records.length === limit && last !== undefined
          ? { submittedAt: last.submittedAt, id: last.id }
          : null,
    });
  }

  async #keys(
    context: CallContext,
    records: readonly SubmissionRecord[],
  ): Promise<ReadonlyMap<string, Uint8Array | null>> {
    const { tenant } = context;
    const live = records.filter((record) => record.erasedAt === null).map((record) => record.id);
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.subjectKeys.wrappedKeys(tenant, live)),
      { readOnly: true },
    );
    return read.ok ? read.value : new Map();
  }
}
