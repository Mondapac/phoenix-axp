import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLES_VIEW } from '../../contracts/permissions';
import type { RoleRecord, RoleRepository } from '../roles/role.repository';

/** The tenant's roles, by key: system, default and custom. */
export class ListRoles extends UseCase<void, RoleRecord[]> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.list-roles',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly roles: RoleRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<RoleRecord[], never>> {
    const { tenant } = context;
    return this.unitOfWork.run(tenant, async () => ok(await this.roles.list(tenant)), {
      readOnly: true,
    });
  }
}
