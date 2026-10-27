// SPIKE: the closure-table read behind SiteTreeFacade, in its own read-only unit.
import { Inject, Injectable } from '@nestjs/common';
import { ok, type TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import type { SiteTreeFacade } from '../contracts/site-tree.facade';
import type { AncestorDepths } from '../domain/subtree-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class SiteTreeRepository implements SiteTreeFacade {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  async ancestorsOf(tenant: TenantContext, siteId: string): Promise<AncestorDepths> {
    if (!UUID.test(siteId)) return new Map();
    const result = await this.unitOfWork.run(
      tenant,
      async () =>
        ok(
          await this.prisma.tx(tenant).siteAncestry.findMany({
            where: { tenantId: tenant.tenantId, descendantId: siteId },
            select: { ancestorId: true, depth: true },
          }),
        ),
      { readOnly: true },
    );
    if (!result.ok) return new Map();
    return new Map(result.value.map((row) => [row.ancestorId, row.depth]));
  }
}
