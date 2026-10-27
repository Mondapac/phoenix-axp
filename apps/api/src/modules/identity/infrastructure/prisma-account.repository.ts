import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, Population, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type { AccountListItem, AccountRepository } from '../application/account.repository';
import type { Account, AccountSource, AccountStatus } from '../domain/account';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const COLUMNS = {
  id: true,
  population: true,
  source: true,
  subject: true,
  username: true,
  status: true,
  version: true,
} as const;

const UNIQUE_KEYS = new Set(['account_tenant_id_username_key', 'account_tenant_id_subject_key']);

/** Staff accounts in `identity.account`. */
@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenant: TenantContext, id: Id<'Account'>): Promise<Account | null> {
    const row = await this.prisma.tx(tenant).account.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: COLUMNS,
    });
    return row === null ? null : accountOf(row);
  }

  async findBySubject(tenant: TenantContext, subject: string): Promise<Account | null> {
    const row = await this.prisma.tx(tenant).account.findUnique({
      where: {
        tenantId_subject: { tenantId: tenant.tenantId, subject },
        tenantId: tenant.tenantId,
      },
      select: COLUMNS,
    });
    return row === null ? null : accountOf(row);
  }

  async findByUsername(tenant: TenantContext, username: string): Promise<Account | null> {
    const row = await this.prisma.tx(tenant).account.findUnique({
      where: {
        tenantId_username: { tenantId: tenant.tenantId, username },
        tenantId: tenant.tenantId,
      },
      select: COLUMNS,
    });
    return row === null ? null : accountOf(row);
  }

  async list(tenant: TenantContext): Promise<AccountListItem[]> {
    const rows = await this.prisma.tx(tenant).account.findMany({
      where: { tenantId: tenant.tenantId },
      select: { ...COLUMNS, createdAt: true },
      orderBy: [{ username: 'asc' }],
    });
    return rows.map((row) => ({
      ...accountOf(row),
      createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
    }));
  }

  async insert(
    tenant: TenantContext,
    account: {
      readonly id: Id<'Account'>;
      readonly source: AccountSource;
      readonly subject: string | null;
      readonly username: string;
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'> {
    try {
      await this.prisma.tx(tenant).account.create({
        data: {
          tenantId: tenant.tenantId,
          id: account.id,
          population: 'tenant-staff',
          source: account.source,
          subject: account.subject,
          username: account.username,
          status: 'active',
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (UNIQUE_KEYS.has(this.prisma.violatedConstraint(error) ?? '')) return 'taken';
      throw error;
    }
  }

  async link(
    tenant: TenantContext,
    id: Id<'Account'>,
    expectedVersion: number,
    subject: string,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).account.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion, subject: null },
      data: { subject, version: { increment: 1 }, updatedAt: dateOf(at) },
    });
    if (count === 0) throw new StaleAggregateError('identity.account', id);
  }

  async disable(
    tenant: TenantContext,
    id: Id<'Account'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).account.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: { status: 'disabled', version: { increment: 1 }, updatedAt: dateOf(at) },
    });
    if (count === 0) throw new StaleAggregateError('identity.account', id);
  }
}

function accountOf(row: {
  id: string;
  population: string;
  source: string;
  subject: string | null;
  username: string;
  status: string;
  version: number;
}): Account {
  return {
    id: row.id as Id<'Account'>,
    population: row.population as Population,
    source: row.source as AccountSource,
    subject: row.subject,
    username: row.username,
    status: row.status as AccountStatus,
    version: row.version,
  };
}
