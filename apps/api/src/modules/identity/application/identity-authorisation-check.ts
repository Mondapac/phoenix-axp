// SPIKE (PoC 2): identity's AuthorisationCheck (for the UseCaseGate) and StaffAccessFacade
// (for site-scoped checks in other modules). Both read the account's status and its grants
// from PostgreSQL on every call: a revoked role or a disabled account counts on the next
// request.
import { Inject, Injectable } from '@nestjs/common';
import { ok, type CallContext } from '@phoenix/shared-kernel';
import type {
  AccessDeclaration,
  AccessDecision,
  AuthorisationCheck,
  PermissionKey,
} from '../../../platform/authz';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import { SITE_TREE_FACADE, grantCoversSite, type SiteTreeFacade } from '../../site';
import type { StaffAccessFacade } from '../contracts/staff-access.facade';
import { IDENTITY_STORE, type IdentityStore, type GrantRow } from './ports/identity-store';

const DENIED: AccessDecision = Object.freeze({
  allowed: false,
  denial: Object.freeze({ code: 'access.denied' }),
});
const ALLOWED: AccessDecision = Object.freeze({ allowed: true });

@Injectable()
export class IdentityAuthorisationCheck implements AuthorisationCheck, StaffAccessFacade {
  constructor(
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(SITE_TREE_FACADE) private readonly sites: SiteTreeFacade,
  ) {}

  /** The active account's grants, or null when the actor is not an active staff account. */
  async #grants(context: CallContext): Promise<GrantRow[] | null> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return null;
    const result = await this.unitOfWork.run(
      tenant,
      async () => {
        const account = await this.accounts.accountById(tenant, actor.accountId);
        if (account === null || account.status !== 'active') return ok(null);
        return ok(await this.accounts.grantsOf(tenant, actor.accountId));
      },
      { readOnly: true },
    );
    return result.ok ? result.value : null;
  }

  async check(context: CallContext, declaration: AccessDeclaration): Promise<AccessDecision> {
    const grants = await this.#grants(context);
    if (grants === null) return DENIED;
    const { rule } = declaration;
    if (rule.kind === 'own-resources') return ALLOWED; // the body checks ownership
    if (rule.kind !== 'permissions') return DENIED;
    // Held in some scope: the gate's question. Which site is the body's (permittedAtSite).
    const held = new Set(grants.flatMap((grant) => grant.permissions));
    return rule.allOf.every((key) => held.has(key)) ? ALLOWED : DENIED;
  }

  async permittedAtSite(
    context: CallContext,
    keys: readonly PermissionKey[],
    siteId: string,
  ): Promise<boolean> {
    const grants = await this.#grants(context);
    if (grants === null || grants.length === 0) return false;
    const ancestors = await this.sites.ancestorsOf(context.tenant, siteId);
    return keys.every((key) =>
      grants.some((grant) => grant.permissions.includes(key) && grantCoversSite(grant, ancestors)),
    );
  }
}
