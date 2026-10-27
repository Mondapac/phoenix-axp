import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_ORGANIZATIONS_VIEW } from '../../contracts/permissions';
import type { OrganizationRecord, OrganizationRepository } from '../organization.repository';

/** The organization chart as a flat list, parents before children. */
export class ListOrganizations extends UseCase<void, OrganizationRecord[]> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.list-organizations',
    rule: { kind: 'permissions', allOf: [TENANCY_ORGANIZATIONS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly organizations: OrganizationRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<OrganizationRecord[], never>> {
    const { tenant } = context;
    return this.unitOfWork.run(tenant, async () => ok(await this.organizations.list(tenant)), {
      readOnly: true,
    });
  }
}
