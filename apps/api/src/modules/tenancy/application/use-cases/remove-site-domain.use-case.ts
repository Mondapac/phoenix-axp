import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_MANAGE } from '../../contracts/permissions';
import { SITE_DOMAIN_REMOVED } from '../../domain/audit-actions';
import { SITE_DOMAIN_NOT_FOUND, type SiteDomainNotFound } from '../failures';
import type { SiteRepository } from '../site.repository';

/** Stops serving a site on one of its domains. */
export class RemoveSiteDomain extends UseCase<
  { readonly domainId: Id<'SiteDomain'> },
  void,
  SiteDomainNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.remove-site-domain',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly sites: SiteRepository,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: { readonly domainId: Id<'SiteDomain'> },
  ): Promise<Result<void, SiteDomainNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<void, SiteDomainNotFound>(tenant, async () => {
      const domain = await this.sites.findDomain(tenant, input.domainId);
      if (domain === null) return err(SITE_DOMAIN_NOT_FOUND);
      await this.sites.removeDomain(tenant, domain.id);
      await this.audit.record(
        context,
        SITE_DOMAIN_REMOVED.entry(domain.id, { before: { siteId: domain.siteId } }),
      );
      return ok(undefined);
    });
  }
}
