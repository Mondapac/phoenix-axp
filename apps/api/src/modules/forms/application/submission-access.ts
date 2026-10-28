import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  resolveFieldAccess,
  type FieldAccess,
  type FieldDescriptor,
  type FieldMode,
  type FieldRuleReader,
  type PermissionKey,
  type SiteAncestryReader,
} from '../../../platform/authz';
import { FORMS_SUBMISSION_READ, FORMS_SUBMISSION_SUBMIT_ON_BEHALF } from '../contracts/permissions';
import type { FormField } from '../domain/form-fields';

/**
 * The field descriptors of answers written under `writtenUnder`, for FieldPolicy (ADR-0024
 * decision 5): a field is sensitive when that revision or the form's current revision marks it.
 */
export function descriptorsOf(
  writtenUnder: readonly FormField[],
  current: readonly FormField[] | null,
): FieldDescriptor[] {
  const now = new Map((current ?? []).map((field) => [field.id as string, field]));
  return writtenUnder.map((field) => {
    const latest = now.get(field.id);
    const sensitive = field.sensitive || latest?.sensitive === true;
    const portal = latest?.portal ?? field.portal;
    return portal === undefined ? { id: field.id, sensitive } : { id: field.id, sensitive, portal };
  });
}

/**
 * The field access of the calling staff member on a form's submissions, through the one
 * evaluator (`resolveFieldAccess`, ADR-0024 decision 5): tenant, site, then the definition
 * qualifier (the form's id), then the role's field rules. Each path asks for one operation
 * only, so only the grants conferring that operation's key count: reading the inbox
 * (`forRead`) never sees a field that only a submit-on-behalf grant opens, and submitting on
 * behalf (`forOnBehalf`) never gains a field from a read grant (security review of slice 2.5,
 * H1). Reads committed grants in units of their own: call it before the use case's unit.
 */
export class SubmissionAccess {
  constructor(
    private readonly rules: FieldRuleReader,
    private readonly sites: SiteAncestryReader,
  ) {}

  /**
   * For the inbox and the submission view: `canRead` and the modes from read grants only. The
   * write half is emptied, so nothing can write with a read grant (security review of PR #34, L1).
   */
  async forRead(
    context: CallContext,
    form: { readonly id: Id<'Form'>; readonly siteId: Id<'Site'> },
    fields: readonly FieldDescriptor[],
  ): Promise<FieldAccess> {
    const access = await this.#resolve(context, form, fields, FORMS_SUBMISSION_READ.key);
    return { ...access, canWrite: false, writeModes: hiddenModes(fields) };
  }

  /**
   * For submitting on behalf: `canWrite` and the modes from submit-on-behalf grants only. The
   * read half is emptied, so nothing projects with an on-behalf grant (review of PR #34, L1).
   */
  async forOnBehalf(
    context: CallContext,
    form: { readonly id: Id<'Form'>; readonly siteId: Id<'Site'> },
    fields: readonly FieldDescriptor[],
  ): Promise<FieldAccess> {
    const access = await this.#resolve(
      context,
      form,
      fields,
      FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key,
    );
    return { ...access, canRead: false, readModes: hiddenModes(fields) };
  }

  #resolve(
    context: CallContext,
    form: { readonly id: Id<'Form'>; readonly siteId: Id<'Site'> },
    fields: readonly FieldDescriptor[],
    key: PermissionKey,
  ): Promise<FieldAccess> {
    return resolveFieldAccess(this.rules, this.sites, context, form.siteId, {
      definitionId: form.id as string as Id<'Definition'>,
      operations: { read: key, write: key },
      fields,
    });
  }
}

const hiddenModes = (fields: readonly FieldDescriptor[]): ReadonlyMap<Id<'Field'>, FieldMode> =>
  new Map(fields.map((field) => [field.id, 'hidden']));

export const SUBMISSION_ACCESS = Symbol('SUBMISSION_ACCESS');
