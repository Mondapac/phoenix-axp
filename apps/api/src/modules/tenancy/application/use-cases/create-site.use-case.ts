import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SITES_MANAGE } from '../../contracts/permissions';
import { SITE_CREATED } from '../../domain/audit-actions';
import { childDepth } from '../../domain/tree';
import { parseName, parseSlug } from '../../domain/values';
import {
  ORGANIZATION_NOT_FOUND,
  SITE_NOT_FOUND,
  type DepthExceeded,
  type InvalidValue,
  type OrganizationNotFound,
  type SiteNotFound,
  type SlugTaken,
} from '../failures';
import type { OrganizationRepository } from '../organization.repository';
import type { SiteRepository } from '../site.repository';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

export interface CreateSiteInput {
  /** Null for a root site. */
  readonly parentSiteId: Id<'Site'> | null;
  readonly organizationId: Id<'Organization'> | null;
  readonly slug: string;
  readonly name: string;
}

export type CreateSiteFailure =
  InvalidValue | SiteNotFound | OrganizationNotFound | SlugTaken | DepthExceeded;

/** Creates a site, as a root or under a parent, within the tenant's depth ceiling. */
export class CreateSite extends UseCase<CreateSiteInput, { id: Id<'Site'> }, CreateSiteFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.create-site',
    rule: { kind: 'permissions', allOf: [TENANCY_SITES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly sites: SiteRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: CreateSiteInput,
  ): Promise<Result<{ id: Id<'Site'> }, CreateSiteFailure>> {
    const slug = parseSlug(input.slug);
    if (!slug.ok) return Promise.resolve(slug);
    const name = parseName(input.name);
    if (!name.ok) return Promise.resolve(name);
    const id = this.ids.next<'Site'>();
    const { tenant } = context;

    return this.unitOfWork.run<{ id: Id<'Site'> }, CreateSiteFailure>(tenant, async () => {
      const now = this.clock.now();
      const { maxSiteDepth } = await this.settings.lockStructure(tenant, now);
      let parentDepth: number | null = null;
      if (input.parentSiteId !== null) {
        const parent = await this.sites.find(tenant, input.parentSiteId);
        if (parent === null) return err(SITE_NOT_FOUND);
        parentDepth = parent.depth;
      }
      if (
        input.organizationId !== null &&
        (await this.organizations.find(tenant, input.organizationId)) === null
      ) {
        return err(ORGANIZATION_NOT_FOUND);
      }
      const depth = childDepth(parentDepth, maxSiteDepth);
      if (!depth.ok) return depth;

      const site = {
        id,
        parentSiteId: input.parentSiteId,
        organizationId: input.organizationId,
        slug: slug.value,
        name: name.value,
        depth: depth.value,
      };
      if ((await this.sites.insert(tenant, site, now)) === 'slug-taken') {
        return err({ code: 'tenancy.site.slug-taken' } as const);
      }
      await this.audit.record(
        context,
        SITE_CREATED.entry(id, {
          after: {
            parentSiteId: input.parentSiteId,
            organizationId: input.organizationId,
            depth: depth.value,
          },
        }),
      );
      return ok({ id });
    });
  }
}
