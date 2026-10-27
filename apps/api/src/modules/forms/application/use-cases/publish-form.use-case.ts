import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORMS_FORMS_PUBLISH } from '../../contracts/permissions';
import { FORM_PUBLISHED } from '../../domain/audit-actions';
import { planPublish } from '../../domain/lifecycle';
import {
  FORM_NOT_FOUND,
  FORM_REVISION_NOT_FOUND,
  type AlreadyPublished,
  type FormNotFound,
  type FormRevisionNotFound,
  type InvalidSchema,
} from '../failures';
import type { FormReach } from '../form-reach';
import type { FormRepository } from '../form.repository';
import type { FormSchemaChecker } from '../ports/form-schema-checker';

export interface PublishFormInput {
  readonly formId: Id<'Form'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
  /** A revision of this form; an older one rolls the form back to it. */
  readonly revisionId: Id<'FormRevision'>;
}

/** A revision saved before field ids existed: save it again to publish it (slice 2.5). */
export type RevisionOutdated = { readonly code: 'forms.form-revision.outdated' };

export type PublishFormFailure =
  FormNotFound | FormRevisionNotFound | AlreadyPublished | RevisionOutdated | InvalidSchema;

/**
 * Points the form at one of its revisions, which new submissions then use (a submission keeps
 * the revision it was made with, ADR-0007 V3). Publishing a retired form brings it back. The
 * revision's schema is compiled again with the submission engine first (RE2 patterns, the
 * worker's limits), so a revision saved under older rules is never served.
 */
export class PublishForm extends UseCase<PublishFormInput, void, PublishFormFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.publish-form',
    rule: { kind: 'permissions', allOf: [FORMS_FORMS_PUBLISH.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly reach: FormReach,
    private readonly checker: FormSchemaChecker,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: PublishFormInput,
  ): Promise<Result<void, PublishFormFailure>> {
    const { tenant } = context;
    if ((await this.reach.form(context, FORMS_FORMS_PUBLISH.key, input.formId)) === null) {
      return err(FORM_NOT_FOUND);
    }
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.forms.findRevision(tenant, input.revisionId)),
      { readOnly: true },
    );
    const candidate = read.ok ? read.value : null;
    // Another form's revision answers as one that does not exist.
    if (candidate === null || candidate.formId !== input.formId) {
      return err(FORM_REVISION_NOT_FOUND);
    }
    if (candidate.fields === null) return err({ code: 'forms.form-revision.outdated' } as const);
    const compiled = await this.checker.check(candidate.jsonSchema);
    if (!compiled.ok) return compiled;

    return this.unitOfWork.run<void, PublishFormFailure>(tenant, async () => {
      const form = await this.forms.find(tenant, input.formId);
      if (form === null) return err(FORM_NOT_FOUND);
      const revision = await this.forms.findRevision(tenant, input.revisionId);
      if (revision === null || revision.formId !== form.id) return err(FORM_REVISION_NOT_FOUND);
      const next = planPublish(form, revision.id);
      if (!next.ok) return next;
      await this.forms.saveState(tenant, form.id, input.version, next.value, this.clock.now());
      await this.audit.record(
        context,
        FORM_PUBLISHED.entry(form.id, {
          before: { status: form.status, revisionId: form.publishedRevisionId },
          after: { revisionId: revision.id, number: revision.number },
        }),
      );
      return ok(undefined);
    });
  }
}
