import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_MANAGE } from '../../contracts/permissions';
import { SITE_MOVED } from '../../domain/audit-actions';
import { planMove } from '../../domain/tree';
import {
  SITE_NOT_FOUND,
  type DepthExceeded,
  type MoveIntoOwnSubtree,
  type SiteNotFound,
} from '../failures';
import type { SiteRepository } from '../site.repository';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

export interface MoveSiteInput {
  readonly siteId: Id<'Site'>;
  /** The new parent, or null to make the site a root. */
  readonly newParentSiteId: Id<'Site'> | null;
}

export type MoveSiteFailure = SiteNotFound | DepthExceeded | MoveIntoOwnSubtree;

/**
 * Moves a site, with its whole subtree, under another parent or to the root. Subtree grants
 * follow the new tree from the next request: the site-ancestry reader caches nothing
 * (ADR-0018 decision 6). Serialised per tenant by the structure lock, so two concurrent moves
 * can never build a cycle (PoC 1 finding).
 */
export class MoveSite extends UseCase<MoveSiteInput, void, MoveSiteFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.move-site',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly sites: SiteRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: MoveSiteInput,
  ): Promise<Result<void, MoveSiteFailure>> {
    const { tenant } = context;
    return this.unitOfWork.run<void, MoveSiteFailure>(tenant, async () => {
      const now = this.clock.now();
      const { maxSiteDepth } = await this.settings.lockStructure(tenant, now);
      const site = await this.sites.find(tenant, input.siteId);
      if (site === null) return err(SITE_NOT_FOUND);
      if (site.parentSiteId === input.newParentSiteId) return ok(undefined);

      const subtree = await this.sites.subtree(tenant, site.id);
      let newParent: { depth: number; withinSubtree: boolean } | null = null;
      if (input.newParentSiteId !== null) {
        const parent = await this.sites.find(tenant, input.newParentSiteId);
        if (parent === null) return err(SITE_NOT_FOUND);
        newParent = { depth: parent.depth, withinSubtree: subtree.ids.includes(parent.id) };
      }
      const plan = planMove({
        depth: site.depth,
        subtreeHeight: subtree.height,
        newParent,
        maxDepth: maxSiteDepth,
      });
      if (!plan.ok) return plan;

      await this.sites.move(tenant, subtree, input.newParentSiteId, plan.value.depthShift, now);
      await this.audit.record(
        context,
        SITE_MOVED.entry(site.id, {
          before: { parentSiteId: site.parentSiteId, depth: site.depth },
          after: {
            parentSiteId: input.newParentSiteId,
            depth: plan.value.depth,
            subtreeSize: subtree.ids.length,
          },
        }),
      );
      return ok(undefined);
    });
  }
}
