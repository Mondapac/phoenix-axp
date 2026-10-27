import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import {
  LastHolderPolicy,
  UseCase,
  type AccessDeclaration,
  type LastHolder,
  type SiteAncestryReader,
  type SiteRelation,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLE_ASSIGNMENTS_MANAGE } from '../../contracts/permissions';
import { ROLE_REVOKED } from '../../domain/audit-actions';
import type { AccountRepository } from '../account.repository';
import { ASSIGNMENT_NOT_FOUND, type AssignmentNotFound } from '../failures';
import {
  definitionAccessOf,
  effectiveKeysOf,
  grantingActorsOf,
  grantScopeOf,
  heldDefinitionGrantsOf,
  heldKeysOf,
  type KeyCatalogue,
} from '../roles/acting-assignments';
import { decideGrant, type GrantRefusal } from '../roles/grant-decision';
import type { AssignmentRecord, RoleRepository } from '../roles/role.repository';
import { siteRelationsFor } from '../roles/site-relations';

export interface RevokeRoleAssignmentInput {
  readonly assignmentId: Id<'RoleAssignment'>;
}

export type RevokeRoleAssignmentFailure = AssignmentNotFound | GrantRefusal | LastHolder;

const isTenantSystemGrant = (a: AssignmentRecord): boolean =>
  a.level === 'tenant' && a.role.kind === 'system' && a.role.scope === 'tenant';

/**
 * Takes a role away from a staff account. The actor may take away only what it could hand
 * out (GrantPolicy, as for a grant), and never leaves the tenant without a system role holder
 * who can sign in (LastHolderPolicy). It counts on the account's next request.
 */
export class RevokeRoleAssignment extends UseCase<
  RevokeRoleAssignmentInput,
  void,
  RevokeRoleAssignmentFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.revoke-role-assignment',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLE_ASSIGNMENTS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly ancestry: SiteAncestryReader,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: RevokeRoleAssignmentInput,
  ): Promise<Result<void, RevokeRoleAssignmentFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') return err(ASSIGNMENT_NOT_FOUND);

    // The site relations are the tenancy module's answers: read before the unit.
    const before = await this.unitOfWork.run(
      tenant,
      async () =>
        ok({
          grant: await this.roles.findAssignment(tenant, input.assignmentId),
          mine: await this.roles.assignmentsOf(tenant, actor.accountId),
        }),
      { readOnly: true },
    );
    if (!before.ok || before.value.grant === null) return err(ASSIGNMENT_NOT_FOUND);
    const siteId = before.value.grant.siteId;
    const relations: Map<Id<'Site'>, SiteRelation> = siteId === null
      ? new Map<Id<'Site'>, SiteRelation>()
      : await siteRelationsFor(this.ancestry, context, before.value.mine, siteId);

    return this.unitOfWork.run<void, RevokeRoleAssignmentFailure>(
      tenant,
      async () => {
        const grant = await this.roles.findAssignment(tenant, input.assignmentId);
        if (grant === null) return err(ASSIGNMENT_NOT_FOUND);
        const account = await this.accounts.find(tenant, grant.accountId);
        if (account === null) return err(ASSIGNMENT_NOT_FOUND);
        const held = await this.roles.assignmentsOf(tenant, account.id);

        const decided = decideGrant(
          grantingActorsOf(
            actor.accountId,
            actor.population,
            await this.roles.assignmentsOf(tenant, actor.accountId),
            IDENTITY_ROLE_ASSIGNMENTS_MANAGE.key,
            this.catalogue,
          ),
          {
            id: grant.role.id,
            scope: grant.role.scope,
            kind: grant.role.kind,
            effectiveKeys: effectiveKeysOf(grant.role, this.catalogue),
            definitionAccess: definitionAccessOf(grant.role, this.catalogue),
          },
          {
            accountId: account.id,
            population: account.population,
            effectiveKeys: heldKeysOf(held, account.population, this.catalogue),
            definitionGrants: heldDefinitionGrantsOf(held, account.population, this.catalogue),
          },
          grantScopeOf(grant),
          relations,
          this.catalogue,
        );
        // A grant beyond the actor's reach is another owner's: not found (CLAUDE.md, ADR-0004
        // decision 5), never a hint that it exists.
        if (!decided.ok) {
          return decided.error.code === 'role.not-grantable' && decided.error.reason === 'subtree'
            ? err(ASSIGNMENT_NOT_FOUND)
            : decided;
        }

        // Losing this grant loses the system role only when it is the account's last one.
        if (
          isTenantSystemGrant(grant) &&
          !held.some((other) => other.id !== grant.id && isTenantSystemGrant(other))
        ) {
          const lastHolder = LastHolderPolicy.allowsLosing(
            await this.roles.tenantSystemRoleHolders(tenant),
            account.id,
          );
          if (!lastHolder.ok) return lastHolder;
        }

        await this.roles.deleteAssignment(tenant, grant.id);
        await this.audit.record(
          context,
          ROLE_REVOKED.entry(grant.id, {
            before: {
              accountId: account.id,
              roleId: grant.role.id,
              level: grant.level,
              siteId: grant.siteId,
              includeDescendants: grant.includeDescendants,
            },
          }),
        );
        return ok(undefined);
      },
      { isolation: 'serializable' },
    );
  }
}
