import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_MANAGE } from '../../contracts/permissions';
import { SITE_UPDATED } from '../../domain/audit-actions';
import { parseName } from '../../domain/values';
import {
  ORGANIZATION_NOT_FOUND,
  SITE_NOT_FOUND,
  type InvalidValue,
  type OrganizationNotFound,
  type SiteNotFound,
} from '../failures';
import type { OrganizationRepository } from '../organization.repository';
import type { SiteRepository } from '../site.repository';

export interface UpdateSiteInput {
  readonly siteId: Id<'Site'>;
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
  readonly name: string;
  /** The organization node the site belongs to (ADR-0018 decision 3), or null for none. */
  readonly organizationId: Id<'Organization'> | null;
}

export type UpdateSiteFailure = InvalidValue | SiteNotFound | OrganizationNotFound;

/** Renames a site and sets or clears its organization link. The slug does not change. */
export class UpdateSite extends UseCase<UpdateSiteInput, void, UpdateSiteFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.update-site',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly sites: SiteRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: UpdateSiteInput,
  ): Promise<Result<void, UpdateSiteFailure>> {
    const name = parseName(input.name);
    if (!name.ok) return Promise.resolve(name);
    const { tenant } = context;

    return this.unitOfWork.run<void, UpdateSiteFailure>(tenant, async () => {
      const site = await this.sites.find(tenant, input.siteId);
      if (site === null) return err(SITE_NOT_FOUND);
      if (
        input.organizationId !== null &&
        (await this.organizations.find(tenant, input.organizationId)) === null
      ) {
        return err(ORGANIZATION_NOT_FOUND);
      }
      await this.sites.update(
        tenant,
        site.id,
        input.version,
        { name: name.value, organizationId: input.organizationId },
        this.clock.now(),
      );
      await this.audit.record(
        context,
        SITE_UPDATED.entry(site.id, {
          before: { organizationId: site.organizationId },
          after: { organizationId: input.organizationId, nameChanged: name.value !== site.name },
        }),
      );
      return ok(undefined);
    });
  }
}
