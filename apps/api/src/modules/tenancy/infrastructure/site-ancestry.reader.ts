import { Inject, Injectable } from '@nestjs/common';
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import type { SiteAncestryReader } from '../../../platform/authz';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import { SITE_REPOSITORY, type SiteRepository } from '../application/site.repository';

/**
 * The tenancy module's answer to "is site X within the subtree of site Y" for platform/authz
 * (ADR-0018 decisions 2 and 6), replacing the fail-closed placeholder. One read-only unit of
 * its own per question, never inside the caller's; it reads committed state from the closure
 * table under row-level security and caches nothing, so a move is seen by the next question.
 * PoC 1 measured this lookup at about 3 ms for a tenant of 500 sites.
 */
@Injectable()
export class ClosureSiteAncestryReader implements SiteAncestryReader {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(SITE_REPOSITORY) private readonly sites: SiteRepository,
  ) {}

  async isWithinSubtree(
    context: CallContext,
    siteId: Id<'Site'>,
    rootSiteId: Id<'Site'>,
  ): Promise<boolean> {
    const { tenant } = context;
    const answer = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.sites.isWithinSubtree(tenant, siteId, rootSiteId)),
      { readOnly: true },
    );
    return answer.ok && answer.value;
  }
}
