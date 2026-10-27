import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ACCOUNTS_VIEW } from '../../contracts/permissions';
import type { AccountListItem, AccountRepository } from '../account.repository';

/** The tenant's staff accounts, by username. */
export class ListStaffAccounts extends UseCase<void, AccountListItem[]> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.list-staff-accounts',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<AccountListItem[], never>> {
    const { tenant } = context;
    return this.unitOfWork.run(
      tenant,
      async () =>
        ok((await this.accounts.list(tenant)).filter((a) => a.population === 'tenant-staff')),
      { readOnly: true },
    );
  }
}
