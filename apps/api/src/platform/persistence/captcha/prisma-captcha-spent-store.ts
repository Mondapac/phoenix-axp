import { Injectable } from '@nestjs/common';
import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import { ChallengeSpentRaceError, type CaptchaSpentStore } from '../../captcha/proof-of-work';
import { PrismaService } from '../prisma.service';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

/** `platform.captcha_spent` through `tx(tenant)`, in the caller's unit. */
@Injectable()
export class PrismaCaptchaSpentStore implements CaptchaSpentStore {
  constructor(private readonly prisma: PrismaService) {}

  async spend(
    tenant: TenantContext,
    challenge: string,
    expiresAt: Temporal.Instant,
  ): Promise<boolean> {
    // A read first: a repeated answer is refused without a failed insert (which would end the
    // unit). Two concurrent spends of one answer still race to the primary key, and the loser's
    // unit fails, so the answer counts once either way.
    const known = await this.prisma.tx(tenant).captchaSpent.findFirst({
      where: { tenantId: tenant.tenantId, challengeHash: challenge },
      select: { expiresAt: true },
    });
    if (known !== null) return false;
    try {
      await this.prisma.tx(tenant).captchaSpent.create({
        data: { tenantId: tenant.tenantId, challengeHash: challenge, expiresAt: dateOf(expiresAt) },
      });
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'captcha_spent_pkey') {
        throw new ChallengeSpentRaceError();
      }
      throw error;
    }
    return true;
  }

  async prune(tenant: TenantContext, before: Temporal.Instant): Promise<number> {
    const { count } = await this.prisma.tx(tenant).captchaSpent.deleteMany({
      where: { tenantId: tenant.tenantId, expiresAt: { lt: dateOf(before) } },
    });
    return count;
  }
}
