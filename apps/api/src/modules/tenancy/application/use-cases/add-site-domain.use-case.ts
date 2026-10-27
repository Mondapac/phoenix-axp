import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_MANAGE } from '../../contracts/permissions';
import { SITE_DOMAIN_ADDED } from '../../domain/audit-actions';
import { parseHostname, parsePathPrefix } from '../../domain/values';
import {
  SITE_NOT_FOUND,
  type InvalidValue,
  type SiteDomainTaken,
  type SiteNotFound,
} from '../failures';
import type { SiteRepository } from '../site.repository';

export interface AddSiteDomainInput {
  readonly siteId: Id<'Site'>;
  readonly hostname: string;
  /** "" or "/" for the whole host; "/a/b" for a site that lives on a path of the host. */
  readonly pathPrefix: string;
}

export type AddSiteDomainFailure = InvalidValue | SiteNotFound | SiteDomainTaken;

/** Lets a site be served on a host, or on a path under a host (ADR-0018 decision 2). */
export class AddSiteDomain extends UseCase<
  AddSiteDomainInput,
  { id: Id<'SiteDomain'> },
  AddSiteDomainFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.add-site-domain',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly sites: SiteRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: AddSiteDomainInput,
  ): Promise<Result<{ id: Id<'SiteDomain'> }, AddSiteDomainFailure>> {
    const hostname = parseHostname(input.hostname);
    if (!hostname.ok) return Promise.resolve(hostname);
    const pathPrefix = parsePathPrefix(input.pathPrefix);
    if (!pathPrefix.ok) return Promise.resolve(pathPrefix);
    const id = this.ids.next<'SiteDomain'>();
    const { tenant } = context;

    return this.unitOfWork.run<{ id: Id<'SiteDomain'> }, AddSiteDomainFailure>(tenant, async () => {
      if ((await this.sites.find(tenant, input.siteId)) === null) return err(SITE_NOT_FOUND);
      const domain = {
        id,
        siteId: input.siteId,
        hostname: hostname.value,
        pathPrefix: pathPrefix.value,
      };
      if ((await this.sites.addDomain(tenant, domain, this.clock.now())) === 'taken') {
        return err({ code: 'tenancy.site-domain.taken' } as const);
      }
      await this.audit.record(
        context,
        SITE_DOMAIN_ADDED.entry(id, { after: { siteId: input.siteId } }),
      );
      return ok({ id });
    });
  }
}
