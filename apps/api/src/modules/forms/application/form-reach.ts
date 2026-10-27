import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  grantsCoverSite,
  type ActorGrantReader,
  type PermissionKey,
  type SiteAncestryReader,
} from '../../../platform/authz';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import type { FormRecord, FormRepository } from './form.repository';

/**
 * Where the actor's form keys reach (ADR-0018 decision 6): the forms keys are site scope, so
 * after the gate has admitted the actor for a key held anywhere, a use case checks the form's
 * site against the grants that confer the key. A form outside the actor's reach answers as one
 * that does not exist. The grants and the subtree are read through their ports, each in a
 * read-only unit of its own, so this runs before the use case's unit, never inside it.
 */
export class FormReach {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly grants: ActorGrantReader,
    private readonly sites: SiteAncestryReader,
  ) {}

  /** True when a grant of the actor that confers `key` covers `siteId`. */
  async covers(context: CallContext, key: PermissionKey, siteId: Id<'Site'>): Promise<boolean> {
    return grantsCoverSite(await this.grants.grantsOf(context), this.sites, context, key, siteId);
  }

  /** The form, when it exists and `key` reaches its site; otherwise null. */
  async form(
    context: CallContext,
    key: PermissionKey,
    formId: Id<'Form'>,
  ): Promise<FormRecord | null> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.forms.find(tenant, formId)),
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return null;
    return (await this.covers(context, key, read.value.siteId)) ? read.value : null;
  }

  /** The forms whose site `key` reaches, in their order. */
  async filter(
    context: CallContext,
    key: PermissionKey,
    forms: readonly FormRecord[],
  ): Promise<FormRecord[]> {
    const grants = await this.grants.grantsOf(context);
    const reached = new Map<string, boolean>();
    const kept: FormRecord[] = [];
    for (const form of forms) {
      let covered = reached.get(form.siteId);
      if (covered === undefined) {
        covered = await grantsCoverSite(grants, this.sites, context, key, form.siteId);
        reached.set(form.siteId, covered);
      }
      if (covered) kept.push(form);
    }
    return kept;
  }
}

export const FORM_REACH = Symbol('FORM_REACH');
