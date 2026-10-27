import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_ORGANIZATIONS_MANAGE } from '../../contracts/permissions';
import { ORGANIZATION_RENAMED } from '../../domain/audit-actions';
import { parseName } from '../../domain/values';
import { ORGANIZATION_NOT_FOUND, type InvalidValue, type OrganizationNotFound } from '../failures';
import type { OrganizationRepository } from '../organization.repository';

export interface RenameOrganizationInput {
  readonly organizationId: Id<'Organization'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
  readonly name: string;
}

export class RenameOrganization extends UseCase<
  RenameOrganizationInput,
  void,
  InvalidValue | OrganizationNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.rename-organization',
    rule: { kind: 'permissions', allOf: [TENANCY_ORGANIZATIONS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: RenameOrganizationInput,
  ): Promise<Result<void, InvalidValue | OrganizationNotFound>> {
    const name = parseName(input.name);
    if (!name.ok) return Promise.resolve(name);
    const { tenant } = context;

    return this.unitOfWork.run<void, InvalidValue | OrganizationNotFound>(tenant, async () => {
      const organization = await this.organizations.find(tenant, input.organizationId);
      if (organization === null) return err(ORGANIZATION_NOT_FOUND);
      await this.organizations.rename(
        tenant,
        organization.id,
        input.version,
        name.value,
        this.clock.now(),
      );
      await this.audit.record(context, ORGANIZATION_RENAMED.entry(organization.id, {}));
      return ok(undefined);
    });
  }
}
