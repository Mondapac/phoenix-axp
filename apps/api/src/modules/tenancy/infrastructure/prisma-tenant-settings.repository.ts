import { Injectable } from '@nestjs/common';
import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type { TenantSettingsRepository } from '../application/tenant-settings.repository';
import {
  DEFAULT_TENANT_SETTINGS,
  SIGN_IN_SOURCES,
  type SignInSource,
  type TenantSettings,
} from '../domain/tenant-settings';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const COLUMNS = { signInSources: true, maxSiteDepth: true, version: true } as const;

/** `tenancy.tenant_settings`: one row per tenant, created by the first save or tree change. */
@Injectable()
export class PrismaTenantSettingsRepository implements TenantSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async read(tenant: TenantContext): Promise<TenantSettings> {
    const row = await this.prisma.tx(tenant).tenantSettings.findUnique({
      where: { tenantId: tenant.tenantId },
      select: COLUMNS,
    });
    return row === null ? DEFAULT_TENANT_SETTINGS : settingsOf(row);
  }

  async lockStructure(tenant: TenantContext, at: Temporal.Instant): Promise<TenantSettings> {
    const tx = this.prisma.tx(tenant);
    const bump = () =>
      tx.tenantSettings.updateMany({
        where: { tenantId: tenant.tenantId },
        data: { structureVersion: { increment: 1 } },
      });
    // The UPDATE takes the row lock. A tenant without a row gets one first: ON CONFLICT DO
    // NOTHING waits for a concurrent first insert and never fails on it, and the second UPDATE
    // then queues behind that unit's lock.
    if ((await bump()).count === 0) {
      await tx.tenantSettings.createMany({
        data: [
          {
            tenantId: tenant.tenantId,
            signInSources: [...DEFAULT_TENANT_SETTINGS.signInSources],
            maxSiteDepth: DEFAULT_TENANT_SETTINGS.maxSiteDepth,
            structureVersion: 0,
            version: DEFAULT_TENANT_SETTINGS.version,
            updatedAt: dateOf(at),
          },
        ],
        skipDuplicates: true,
      });
      await bump();
    }
    return this.read(tenant);
  }

  async save(
    tenant: TenantContext,
    expectedVersion: number,
    settings: { readonly signInSources: readonly SignInSource[]; readonly maxSiteDepth: number },
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).tenantSettings.updateMany({
      where: { tenantId: tenant.tenantId, version: expectedVersion },
      data: {
        signInSources: [...settings.signInSources],
        maxSiteDepth: settings.maxSiteDepth,
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('tenancy.tenant-settings', tenant.tenantId);
  }
}

function settingsOf(row: {
  signInSources: string[];
  maxSiteDepth: number;
  version: number;
}): TenantSettings {
  // The CHECK keeps the column to the known sources; anything else is dropped, never trusted.
  const sources = SIGN_IN_SOURCES.filter((source) => row.signInSources.includes(source));
  return { signInSources: sources, maxSiteDepth: row.maxSiteDepth, version: row.version };
}
