import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  resolveFieldAccess,
  type FieldAccess,
  type FieldDescriptor,
  type FieldRuleReader,
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
 * qualifier (the form's id), then the role's field rules. The operations are reading the inbox
 * and submitting on behalf (the create key, decision 7). Reads committed grants in units of
 * their own: call it before the use case's unit.
 */
export class SubmissionAccess {
  constructor(
    private readonly rules: FieldRuleReader,
    private readonly sites: SiteAncestryReader,
  ) {}

  of(
    context: CallContext,
    form: { readonly id: Id<'Form'>; readonly siteId: Id<'Site'> },
    fields: readonly FieldDescriptor[],
  ): Promise<FieldAccess> {
    return resolveFieldAccess(this.rules, this.sites, context, form.siteId, {
      definitionId: form.id as string as Id<'Definition'>,
      operations: {
        read: FORMS_SUBMISSION_READ.key,
        write: FORMS_SUBMISSION_SUBMIT_ON_BEHALF.key,
      },
      fields,
    });
  }
}

export const SUBMISSION_ACCESS = Symbol('SUBMISSION_ACCESS');
