import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_VIEW } from '../../contracts/permissions';
import { SITE_NOT_FOUND, type SiteNotFound } from '../failures';
import type { SiteRecord, SiteRepository } from '../site.repository';

export interface ListSitesInput {
  /** Only the subtree of this site, itself included; null for the whole tenant. */
  readonly rootSiteId: Id<'Site'> | null;
}

/** The site tree as a flat list, parents before children; the client builds the tree. */
export class ListSites extends UseCase<ListSitesInput, SiteRecord[], SiteNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.list-sites',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly sites: SiteRepository,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: ListSitesInput,
  ): Promise<Result<SiteRecord[], SiteNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<SiteRecord[], SiteNotFound>(
      tenant,
      async () => {
        if (
          input.rootSiteId !== null &&
          (await this.sites.find(tenant, input.rootSiteId)) === null
        ) {
          return err(SITE_NOT_FOUND);
        }
        return ok(await this.sites.list(tenant, input.rootSiteId));
      },
      { readOnly: true },
    );
  }
}
