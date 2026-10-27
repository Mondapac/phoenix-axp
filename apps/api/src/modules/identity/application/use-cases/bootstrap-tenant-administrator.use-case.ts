import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { parseUsername } from '../../domain/account';
import {
  ACCOUNT_CREATED,
  FOUNDING_ADMINISTRATOR_ASSIGNED,
  SYSTEM_ROLE_SEEDED,
} from '../../domain/audit-actions';
import { TENANT_SYSTEM_ROLE_KEY } from '../../domain/role';
import type { AccountRepository } from '../account.repository';
import {
  ACCOUNT_NOT_FOUND,
  type AccountDisabled,
  type AccountNotFound,
  type InvalidUsername,
  type RoleKeyTaken,
  type UsernameTaken,
} from '../failures';
import type { RoleRepository } from '../roles/role.repository';

export interface BootstrapTenantAdministratorInput {
  readonly username: string;
  /**
   * The account the operator confirmed with the person: the id an earlier run printed. Without
   * it the use case never grants (security review of this command, M1).
   */
  readonly accountId?: Id<'Account'>;
}

/**
 * `granted`: the account now holds the system role. `sign-in-needed`: the account exists (or was
 * just created as a local account) but has never signed in; the person signs in once, then the
 * command runs again (security review of slice 1.5, M1: no grant before the link).
 * `confirm-needed`: the account is linked; the operator confirms with the person that they
 * signed in, then runs again with this account id. A grant thus always names the account the
 * operator confirmed, never whoever linked a username first.
 */
export type BootstrapOutcome =
  | { readonly outcome: 'granted'; readonly accountId: Id<'Account'> }
  | {
      readonly outcome: 'sign-in-needed';
      readonly accountId: Id<'Account'>;
      readonly created: boolean;
    }
  | { readonly outcome: 'confirm-needed'; readonly accountId: Id<'Account'> };

/** The tenant already has a system role holder who can sign in: studio grants from here on. */
export type HasAdministrator = { readonly code: 'identity.tenant.has-administrator' };

export type BootstrapFailure =
  | InvalidUsername
  | AccountNotFound
  | AccountDisabled
  | HasAdministrator
  | RoleKeyTaken
  | UsernameTaken;

/**
 * The first administrator of a tenant (owner card of slice 1.6, 2026-10-27: a command of the
 * platform team now, an admin panel page later). Runs only while the tenant has no system role
 * holder who can sign in, so it also recovers a tenant whose holders all left; otherwise it is
 * refused. It seeds the tenant's system role if missing and grants it to the staff account of
 * the username, creating a local account when there is none, and only once the operator has
 * confirmed the account by its id (see {@link BootstrapOutcome}). This founding grant is not a
 * GrantPolicy grant (grant-policy.ts): no actor holds anything yet. System actor only.
 */
export class BootstrapTenantAdministrator extends UseCase<
  BootstrapTenantAdministratorInput,
  BootstrapOutcome,
  BootstrapFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.bootstrap-tenant-administrator',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: BootstrapTenantAdministratorInput,
  ): Promise<Result<BootstrapOutcome, BootstrapFailure>> {
    const username = parseUsername(input.username);
    if (!username.ok) return Promise.resolve(username);
    const { tenant } = context;
    return this.unitOfWork.run<BootstrapOutcome, BootstrapFailure>(
      tenant,
      async () => {
        if ((await this.roles.tenantSystemRoleHolders(tenant)).length > 0) {
          return err({ code: 'identity.tenant.has-administrator' } as const);
        }
        const now = this.clock.now();
        const account = await this.accounts.findByUsername(tenant, username.value);
        if (account === null) {
          if (input.accountId !== undefined) return err(ACCOUNT_NOT_FOUND);
          const id = this.ids.next<'Account'>();
          const inserted = await this.accounts.insert(
            tenant,
            { id, source: 'local', subject: null, username: username.value },
            now,
          );
          if (inserted === 'taken')
            return err({ code: 'identity.account.username-taken' } as const);
          await this.audit.record(
            context,
            ACCOUNT_CREATED.entry(id, { after: { source: 'local' } }),
          );
          return ok({ outcome: 'sign-in-needed', accountId: id, created: true });
        }
        if (account.population !== 'tenant-staff') return err(ACCOUNT_NOT_FOUND);
        if (input.accountId !== undefined && input.accountId !== account.id) {
          return err(ACCOUNT_NOT_FOUND);
        }
        if (account.status !== 'active') {
          return err({ code: 'identity.account.disabled' } as const);
        }
        if (account.subject === null) {
          return ok({ outcome: 'sign-in-needed', accountId: account.id, created: false });
        }
        if (input.accountId === undefined) {
          return ok({ outcome: 'confirm-needed', accountId: account.id });
        }

        let role = await this.roles.findTenantSystemRole(tenant);
        if (role === null) {
          const id = this.ids.next<'Role'>();
          const seeded = await this.roles.insertTenantSystemRole(
            tenant,
            { id, key: TENANT_SYSTEM_ROLE_KEY },
            now,
          );
          // A custom role created before CreateRole reserved the key: rename it first.
          if (seeded === 'taken') return err({ code: 'identity.role.key-taken' } as const);
          await this.audit.record(context, SYSTEM_ROLE_SEEDED.entry(id, {}));
          role = await this.roles.find(tenant, id);
          if (role === null) throw new Error('The seeded system role is not readable');
        }
        const assignmentId = this.ids.next<'RoleAssignment'>();
        const inserted = await this.roles.insertAssignment(
          tenant,
          {
            id: assignmentId,
            accountId: account.id,
            roleId: role.id,
            level: 'tenant',
            siteId: null,
            includeDescendants: false,
          },
          now,
        );
        // An existing grant of an active, linked account would have made it a holder above.
        if (inserted === 'exists') throw new Error('A founding grant already exists');
        await this.audit.record(
          context,
          FOUNDING_ADMINISTRATOR_ASSIGNED.entry(assignmentId, {
            after: { accountId: account.id, roleId: role.id },
          }),
        );
        return ok({ outcome: 'granted', accountId: account.id });
      },
      { isolation: 'serializable' },
    );
  }
}
