import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLES_VIEW } from '../../contracts/permissions';
import type { AccountRepository } from '../account.repository';
import { ACCOUNT_NOT_FOUND, type AccountNotFound } from '../failures';
import type { AssignmentRecord, RoleRepository } from '../roles/role.repository';

/** The roles granted to one staff account of the tenant, oldest first. */
export class ListAccountRoleAssignments extends UseCase<
  { readonly accountId: Id<'Account'> },
  AssignmentRecord[],
  AccountNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.list-account-role-assignments',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly roles: RoleRepository,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: { readonly accountId: Id<'Account'> },
  ): Promise<Result<AssignmentRecord[], AccountNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<AssignmentRecord[], AccountNotFound>(
      tenant,
      async () => {
        const account = await this.accounts.find(tenant, input.accountId);
        if (account === null || account.population !== 'tenant-staff') {
          return err(ACCOUNT_NOT_FOUND);
        }
        return ok(await this.roles.assignmentsOf(tenant, account.id));
      },
      { readOnly: true },
    );
  }
}
