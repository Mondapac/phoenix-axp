import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_ORGANIZATIONS_MANAGE } from '../../contracts/permissions';
import { ORGANIZATION_CREATED } from '../../domain/audit-actions';
import { childDepth, MAX_ORGANIZATION_DEPTH, type DepthExceeded } from '../../domain/tree';
import { parseName } from '../../domain/values';
import { ORGANIZATION_NOT_FOUND, type InvalidValue, type OrganizationNotFound } from '../failures';
import type { OrganizationRepository } from '../organization.repository';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

export interface CreateOrganizationInput {
  readonly parentId: Id<'Organization'> | null;
  readonly name: string;
}

export type CreateOrganizationFailure = InvalidValue | OrganizationNotFound | DepthExceeded;

/** Adds a node to the organization chart (ADR-0018 decision 3). */
export class CreateOrganization extends UseCase<
  CreateOrganizationInput,
  { id: Id<'Organization'> },
  CreateOrganizationFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.create-organization',
    rule: { kind: 'permissions', allOf: [TENANCY_ORGANIZATIONS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: CreateOrganizationInput,
  ): Promise<Result<{ id: Id<'Organization'> }, CreateOrganizationFailure>> {
    const name = parseName(input.name);
    if (!name.ok) return Promise.resolve(name);
    const id = this.ids.next<'Organization'>();
    const { tenant } = context;

    return this.unitOfWork.run<{ id: Id<'Organization'> }, CreateOrganizationFailure>(
      tenant,
      async () => {
        const now = this.clock.now();
        await this.settings.lockStructure(tenant, now);
        let parentDepth: number | null = null;
        if (input.parentId !== null) {
          const parent = await this.organizations.find(tenant, input.parentId);
          if (parent === null) return err(ORGANIZATION_NOT_FOUND);
          parentDepth = parent.depth;
        }
        const depth = childDepth(parentDepth, MAX_ORGANIZATION_DEPTH);
        if (!depth.ok) return depth;

        await this.organizations.insert(
          tenant,
          { id, parentId: input.parentId, name: name.value, depth: depth.value },
          now,
        );
        await this.audit.record(
          context,
          ORGANIZATION_CREATED.entry(id, {
            after: { parentId: input.parentId, depth: depth.value },
          }),
        );
        return ok({ id });
      },
    );
  }
}
