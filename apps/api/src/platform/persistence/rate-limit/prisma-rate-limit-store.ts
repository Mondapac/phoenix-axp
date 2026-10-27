import { Injectable } from '@nestjs/common';
import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import { WindowRaceError, type RateLimitStore } from '../../rate-limit/rate-limiter';
import { PrismaService } from '../prisma.service';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

/** `platform.rate_limit_window` through `tx(tenant)`, in the caller's unit. */
@Injectable()
export class PrismaRateLimitStore implements RateLimitStore {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    tenant: TenantContext,
    bucket: string,
    windowStart: Temporal.Instant,
    limit: number,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).rateLimitWindow.updateMany({
      where: {
        tenantId: tenant.tenantId,
        bucket,
        windowStart: dateOf(windowStart),
        hits: { lt: limit },
      },
      data: { hits: { increment: 1 } },
    });
    return count === 1;
  }

  async exists(
    tenant: TenantContext,
    bucket: string,
    windowStart: Temporal.Instant,
  ): Promise<boolean> {
    const row = await this.prisma.tx(tenant).rateLimitWindow.findFirst({
      where: { tenantId: tenant.tenantId, bucket, windowStart: dateOf(windowStart) },
      select: { hits: true },
    });
    return row !== null;
  }

  async open(tenant: TenantContext, bucket: string, windowStart: Temporal.Instant): Promise<void> {
    try {
      await this.prisma.tx(tenant).rateLimitWindow.create({
        data: { tenantId: tenant.tenantId, bucket, windowStart: dateOf(windowStart), hits: 1 },
      });
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'rate_limit_window_pkey') {
        throw new WindowRaceError();
      }
      throw error;
    }
  }

  async prune(tenant: TenantContext, before: Temporal.Instant): Promise<number> {
    const { count } = await this.prisma.tx(tenant).rateLimitWindow.deleteMany({
      where: { tenantId: tenant.tenantId, windowStart: { lt: dateOf(before) } },
    });
    return count;
  }
}
