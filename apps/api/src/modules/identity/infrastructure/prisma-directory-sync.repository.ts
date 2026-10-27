import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  DirectorySyncRepository,
  DirectorySyncState,
} from '../application/directory-sync.repository';
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  SYNC_OUTCOMES,
  type SyncOutcome,
} from '../domain/directory-sync';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date | null): Temporal.Instant | null =>
  date === null ? null : Temporal.Instant.fromEpochMilliseconds(date.getTime());

/** The state of a tenant that never ran a sync nor changed its interval. */
const DEFAULTS: DirectorySyncState = Object.freeze({
  intervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  lastStartedAt: null,
  lastOutcome: null,
  lastFinishedAt: null,
  accountsChecked: 0,
  accountsDisabled: 0,
  accountsEnabled: 0,
  version: 1,
});

/** The tenant's directory sync row in `identity.directory_sync`. */
@Injectable()
export class PrismaDirectorySyncRepository implements DirectorySyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  async read(tenant: TenantContext): Promise<DirectorySyncState> {
    const row = await this.prisma.tx(tenant).directorySync.findUnique({
      where: { tenantId: tenant.tenantId },
    });
    if (row === null) return DEFAULTS;
    return {
      intervalMinutes: row.intervalMinutes,
      lastStartedAt: instantOf(row.lastStartedAt),
      lastOutcome: SYNC_OUTCOMES.includes(row.lastOutcome as SyncOutcome)
        ? (row.lastOutcome as SyncOutcome)
        : null,
      lastFinishedAt: instantOf(row.lastFinishedAt),
      accountsChecked: row.accountsChecked,
      accountsDisabled: row.accountsDisabled,
      accountsEnabled: row.accountsEnabled,
      version: row.version,
    };
  }

  async claim(
    tenant: TenantContext,
    expectedLastStartedAt: Temporal.Instant | null,
    at: Temporal.Instant,
  ) {
    await this.ensure(tenant, at);
    const { count } = await this.prisma.tx(tenant).directorySync.updateMany({
      where: {
        tenantId: tenant.tenantId,
        lastStartedAt: expectedLastStartedAt === null ? null : dateOf(expectedLastStartedAt),
      },
      data: { lastStartedAt: dateOf(at), updatedAt: dateOf(at) },
    });
    return count === 1;
  }

  async finish(
    tenant: TenantContext,
    outcome: SyncOutcome,
    counts: { readonly checked: number; readonly disabled: number; readonly enabled: number },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).directorySync.updateMany({
      where: { tenantId: tenant.tenantId },
      data: {
        lastOutcome: outcome,
        lastFinishedAt: dateOf(at),
        accountsChecked: counts.checked,
        accountsDisabled: counts.disabled,
        accountsEnabled: counts.enabled,
        updatedAt: dateOf(at),
      },
    });
  }

  async saveInterval(
    tenant: TenantContext,
    expectedVersion: number,
    intervalMinutes: number,
    at: Temporal.Instant,
  ): Promise<void> {
    await this.ensure(tenant, at);
    const { count } = await this.prisma.tx(tenant).directorySync.updateMany({
      where: { tenantId: tenant.tenantId, version: expectedVersion },
      data: { intervalMinutes, version: { increment: 1 }, updatedAt: dateOf(at) },
    });
    if (count === 0) throw new StaleAggregateError('identity.directory-sync', tenant.tenantId);
  }

  /** The row at its defaults when the tenant has none; a concurrent first insert wins quietly. */
  private async ensure(tenant: TenantContext, at: Temporal.Instant): Promise<void> {
    await this.prisma.tx(tenant).directorySync.createMany({
      data: [
        {
          tenantId: tenant.tenantId,
          intervalMinutes: DEFAULTS.intervalMinutes,
          accountsChecked: 0,
          accountsDisabled: 0,
          accountsEnabled: 0,
          version: DEFAULTS.version,
          updatedAt: dateOf(at),
        },
      ],
      skipDuplicates: true,
    });
  }
}
