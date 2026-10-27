// SPIKE (PoC 2): the one studio use case both staff sources reach through the same rules. The
// gate admits an active staff account holding content.item.read in some scope; the body then
// asks identity whether that key covers this site (ADR-0018: the site itself, or its subtree for
// a grant with includeDescendants). Not covered answers "not found" (ADR-0004 decision 5).
import { Inject } from '@nestjs/common';
import { err, ok, type CallContext, type Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  USE_CASE_GATE,
  type AccessDeclaration,
  type UseCaseGate,
} from '../../../../platform/authz';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { STAFF_ACCESS_FACADE, type StaffAccessFacade } from '../../../identity';
import { CONTENT_ITEM_READ } from '../../contracts/permissions';
import { CONTENT_STORE, type ContentStore, type ContentSummary } from '../ports/content-store';

export class ListSiteContent extends UseCase<
  { siteId: string },
  { items: ContentSummary[] },
  'site.not-found'
> {
  static override readonly access: AccessDeclaration = {
    name: 'content.list-site-content',
    rule: { kind: 'permissions', allOf: [CONTENT_ITEM_READ] },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(STAFF_ACCESS_FACADE) private readonly access: StaffAccessFacade,
    @Inject(CONTENT_STORE) private readonly content: ContentStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { siteId: string },
  ): Promise<Result<{ items: ContentSummary[] }, 'site.not-found'>> {
    if (!(await this.access.permittedAtSite(context, [CONTENT_ITEM_READ], input.siteId))) {
      return err('site.not-found');
    }
    const { tenant } = context;
    const items = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.content.latestOfSite(tenant, input.siteId, 20)),
      { readOnly: true },
    );
    return items.ok ? ok({ items: items.value }) : err('site.not-found');
  }
}
