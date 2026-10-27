// SPIKE: content items of one site, through the guarded view.
import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type { ContentStore, ContentSummary } from '../application/ports/content-store';

@Injectable()
export class ContentRepository implements ContentStore {
  constructor(private readonly prisma: PrismaService) {}

  async latestOfSite(
    tenant: TenantContext,
    siteId: string,
    take: number,
  ): Promise<ContentSummary[]> {
    return this.prisma.tx(tenant).contentItem.findMany({
      where: { tenantId: tenant.tenantId, ownerSiteId: siteId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, title: true, status: true },
    });
  }
}
