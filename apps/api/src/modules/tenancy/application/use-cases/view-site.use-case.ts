import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_VIEW } from '../../contracts/permissions';
import { SITE_NOT_FOUND, type SiteNotFound } from '../failures';
import type { SiteDomainRecord, SiteRecord, SiteRepository } from '../site.repository';

export interface SiteView extends SiteRecord {
  readonly domains: readonly SiteDomainRecord[];
}

/** One site with its domains. */
export class ViewSite extends UseCase<{ readonly siteId: Id<'Site'> }, SiteView, SiteNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.view-site',
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
    input: { readonly siteId: Id<'Site'> },
  ): Promise<Result<SiteView, SiteNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<SiteView, SiteNotFound>(
      tenant,
      async () => {
        const site = await this.sites.find(tenant, input.siteId);
        if (site === null) return err(SITE_NOT_FOUND);
        return ok({ ...site, domains: await this.sites.domainsOf(tenant, site.id) });
      },
      { readOnly: true },
    );
  }
}
