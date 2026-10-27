import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_ORGANIZATIONS_MANAGE } from '../../contracts/permissions';
import { ORGANIZATION_MOVED } from '../../domain/audit-actions';
import { MAX_ORGANIZATION_DEPTH, planMove } from '../../domain/tree';
import {
  ORGANIZATION_NOT_FOUND,
  type DepthExceeded,
  type MoveIntoOwnSubtree,
  type OrganizationNotFound,
} from '../failures';
import type { OrganizationRepository } from '../organization.repository';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

export interface MoveOrganizationInput {
  readonly organizationId: Id<'Organization'>;
  readonly newParentId: Id<'Organization'> | null;
}

export type MoveOrganizationFailure = OrganizationNotFound | DepthExceeded | MoveIntoOwnSubtree;

/** Re-parents a node of the chart with its subtree. Sites stay where they are (ADR-0018 decision 3). */
export class MoveOrganization extends UseCase<
  MoveOrganizationInput,
  void,
  MoveOrganizationFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.move-organization',
    rule: { kind: 'permissions', allOf: [TENANCY_ORGANIZATIONS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: MoveOrganizationInput,
  ): Promise<Result<void, MoveOrganizationFailure>> {
    const { tenant } = context;
    return this.unitOfWork.run<void, MoveOrganizationFailure>(tenant, async () => {
      const now = this.clock.now();
      await this.settings.lockStructure(tenant, now);
      const node = await this.organizations.find(tenant, input.organizationId);
      if (node === null) return err(ORGANIZATION_NOT_FOUND);
      if (node.parentId === input.newParentId) return ok(undefined);

      const subtree = await this.organizations.subtree(tenant, node.id);
      let newParent: { depth: number; withinSubtree: boolean } | null = null;
      if (input.newParentId !== null) {
        const parent = await this.organizations.find(tenant, input.newParentId);
        if (parent === null) return err(ORGANIZATION_NOT_FOUND);
        newParent = { depth: parent.depth, withinSubtree: subtree.ids.includes(parent.id) };
      }
      const plan = planMove({
        depth: node.depth,
        subtreeHeight: subtree.height,
        newParent,
        maxDepth: MAX_ORGANIZATION_DEPTH,
      });
      if (!plan.ok) return plan;

      await this.organizations.move(tenant, subtree, input.newParentId, plan.value.depthShift, now);
      await this.audit.record(
        context,
        ORGANIZATION_MOVED.entry(node.id, {
          before: { parentId: node.parentId, depth: node.depth },
          after: {
            parentId: input.newParentId,
            depth: plan.value.depth,
            subtreeSize: subtree.ids.length,
          },
        }),
      );
      return ok(undefined);
    });
  }
}
