import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type GrantScope,
  type SiteAncestryReader,
  type SiteRelation,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLE_ASSIGNMENTS_MANAGE } from '../../contracts/permissions';
import { ROLE_ASSIGNED } from '../../domain/audit-actions';
import type { AccountRepository } from '../account.repository';
import {
  ACCOUNT_NOT_FOUND,
  ROLE_NOT_FOUND,
  type AccountNotFound,
  type AccountDisabled,
  type AccountNotLinked,
  type AssignmentExists,
  type RoleNotFound,
  type SiteNotFound,
} from '../failures';
import {
  definitionAccessOf,
  effectiveKeysOf,
  grantingActorsOf,
  heldDefinitionGrantsOf,
  heldKeysOf,
  type KeyCatalogue,
} from '../roles/acting-assignments';
import { decideGrant, type GrantRefusal } from '../roles/grant-decision';
import type { RoleRepository } from '../roles/role.repository';
import { siteRelationsFor } from '../roles/site-relations';

/** Where the grant applies: tenant-wide, or on one site, for that site only or its subtree. */
export type AssignmentPlacement =
  | { readonly level: 'tenant' }
  | {
      readonly level: 'site';
      readonly siteId: Id<'Site'>;
      readonly includeDescendants: boolean;
    };

export interface AssignRoleInput {
  readonly accountId: Id<'Account'>;
  readonly roleId: Id<'Role'>;
  readonly placement: AssignmentPlacement;
}

export type AssignRoleFailure =
  | AccountNotFound
  | AccountNotLinked
  | AccountDisabled
  | RoleNotFound
  | SiteNotFound
  | AssignmentExists
  | GrantRefusal;

/**
 * Grants a role to a staff account (ADR-0004 decision 7, ADR-0018 decision 6), under the first
 * grant of the actor that GrantPolicy accepts: the role's keys are the actor's own, its
 * placement within the actor's reach, and the account outranks nobody it should not. A site
 * grant names a site of the tenant. The account must have signed in once (M1). The grant counts
 * on the account's next request.
 */
export class AssignRole extends UseCase<
  AssignRoleInput,
  { id: Id<'RoleAssignment'> },
  AssignRoleFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.assign-role',
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
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: AssignRoleInput,
  ): Promise<Result<{ id: Id<'RoleAssignment'> }, AssignRoleFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') {
      return err({ code: 'role.not-grantable', reason: 'scope' } as const);
    }
    const { placement } = input;
    const scope: GrantScope =
      placement.level === 'tenant'
        ? { level: 'tenant' }
        : {
            level: 'site',
            siteId: placement.siteId,
            includeDescendants: placement.includeDescendants,
          };

    // Questions to the tenancy module first: each opens a unit of its own.
    let relations = new Map<Id<'Site'>, SiteRelation>();
    if (placement.level === 'site') {
      if (!(await this.ancestry.siteExists(context, placement.siteId))) {
        return err({ code: 'identity.site.not-found' } as const);
      }
      const mine = await this.unitOfWork.run(
        tenant,
        async () => ok(await this.roles.assignmentsOf(tenant, actor.accountId)),
        { readOnly: true },
      );
      if (mine.ok) {
        relations = await siteRelationsFor(this.ancestry, context, mine.value, placement.siteId);
      }
    }

    const id = this.ids.next<'RoleAssignment'>();
    return this.unitOfWork.run<{ id: Id<'RoleAssignment'> }, AssignRoleFailure>(
      tenant,
      async () => {
        const account = await this.accounts.find(tenant, input.accountId);
        if (account === null || account.population !== 'tenant-staff') {
          return err(ACCOUNT_NOT_FOUND);
        }
        if (account.subject === null) return err({ code: 'identity.account.not-linked' } as const);
        // A disabled account gains no role: re-enabling it must not bring back unreviewed grants.
        if (account.status !== 'active') return err({ code: 'identity.account.disabled' } as const);
        const role = await this.roles.find(tenant, input.roleId);
        if (role === null) return err(ROLE_NOT_FOUND);

        const targetGrants = await this.roles.assignmentsOf(tenant, account.id);
        const decided = decideGrant(
          grantingActorsOf(
            actor.accountId,
            actor.population,
            await this.roles.assignmentsOf(tenant, actor.accountId),
            IDENTITY_ROLE_ASSIGNMENTS_MANAGE.key,
            this.catalogue,
          ),
          {
            id: role.id,
            scope: role.scope,
            kind: role.kind,
            effectiveKeys: effectiveKeysOf(role, this.catalogue),
            definitionAccess: definitionAccessOf(role, this.catalogue),
          },
          {
            accountId: account.id,
            population: account.population,
            effectiveKeys: heldKeysOf(targetGrants, account.population, this.catalogue),
            definitionGrants: heldDefinitionGrantsOf(
              targetGrants,
              account.population,
              this.catalogue,
            ),
          },
          scope,
          relations,
          this.catalogue,
        );
        if (!decided.ok) return decided;

        const siteId = scope.level === 'site' ? scope.siteId : null;
        const includeDescendants = scope.level === 'site' && scope.includeDescendants;
        const inserted = await this.roles.insertAssignment(
          tenant,
          {
            id,
            accountId: account.id,
            roleId: role.id,
            level: role.scope,
            siteId,
            includeDescendants,
          },
          this.clock.now(),
        );
        if (inserted === 'exists') {
          return err({ code: 'identity.role-assignment.exists' } as const);
        }
        await this.audit.record(
          context,
          ROLE_ASSIGNED.entry(id, {
            after: {
              accountId: account.id,
              roleId: role.id,
              level: role.scope,
              siteId,
              includeDescendants,
            },
          }),
        );
        return ok({ id });
      },
      { isolation: 'serializable' },
    );
  }
}
