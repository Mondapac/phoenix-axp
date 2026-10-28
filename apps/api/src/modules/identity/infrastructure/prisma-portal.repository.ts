import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  PortalAccountRecord,
  PortalAccountRef,
  PortalRepository,
  StoredPortalCode,
} from '../application/portal/portal.repository';
import type { AccountStatus } from '../domain/account';
import {
  CLOSED_PORTAL,
  PORTAL_ACCOUNT_SOURCE,
  type PortalMethod,
  type PortalSignInSettings,
} from '../domain/portal';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
const instantOf = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

const PORTAL = 'portal-user';
const UNIQUE_ADDRESS = 'portal_contact_tenant_id_kind_lookup_hash_key';

/** Portal sign-in in `identity.portal_*` and the portal accounts of `identity.account`. */
@Injectable()
export class PrismaPortalRepository implements PortalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async settings(tenant: TenantContext): Promise<PortalSignInSettings> {
    const row = await this.prisma.tx(tenant).portalSignInSettings.findUnique({
      where: { tenantId: tenant.tenantId },
      select: { methods: true, countryCallingCode: true, version: true },
    });
    if (row === null) return CLOSED_PORTAL;
    return {
      methods: row.methods as PortalMethod[],
      countryCallingCode: row.countryCallingCode,
      version: row.version,
    };
  }

  async saveSettings(
    tenant: TenantContext,
    settings: Omit<PortalSignInSettings, 'version'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<void> {
    const data = {
      methods: [...settings.methods],
      countryCallingCode: settings.countryCallingCode,
      updatedAt: dateOf(at),
    };
    if (expectedVersion === 0) {
      // The first save: a concurrent first save fails on the primary key (a 409 conflict).
      await this.prisma.tx(tenant).portalSignInSettings.create({
        data: { tenantId: tenant.tenantId, ...data, version: 1 },
      });
      return;
    }
    const { count } = await this.prisma.tx(tenant).portalSignInSettings.updateMany({
      where: { tenantId: tenant.tenantId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new StaleAggregateError('identity.portal-sign-in-settings', tenant.tenantId);
    }
  }

  async insertCode(
    tenant: TenantContext,
    code: {
      readonly id: Id<'PortalCode'>;
      readonly kind: PortalMethod;
      readonly lookupHash: Buffer;
      readonly codeHash: Buffer;
      readonly expiresAt: Temporal.Instant;
    },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).portalCode.create({
      data: {
        tenantId: tenant.tenantId,
        id: code.id,
        kind: code.kind,
        lookupHash: new Uint8Array(code.lookupHash),
        codeHash: new Uint8Array(code.codeHash),
        failures: 0,
        createdAt: dateOf(at),
        expiresAt: dateOf(code.expiresAt),
      },
    });
  }

  async findCode(tenant: TenantContext, id: Id<'PortalCode'>): Promise<StoredPortalCode | null> {
    const row = await this.prisma.tx(tenant).portalCode.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: {
        id: true,
        kind: true,
        lookupHash: true,
        codeHash: true,
        failures: true,
        expiresAt: true,
        spentAt: true,
      },
    });
    if (row === null) return null;
    return {
      id: row.id as Id<'PortalCode'>,
      kind: row.kind as PortalMethod,
      lookupHash: Buffer.from(row.lookupHash),
      codeHash: Buffer.from(row.codeHash),
      failures: row.failures,
      expiresAt: instantOf(row.expiresAt),
      spent: row.spentAt !== null,
    };
  }

  async recordFailure(
    tenant: TenantContext,
    id: Id<'PortalCode'>,
    expectedFailures: number,
    spentAt: Temporal.Instant | null,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).portalCode.updateMany({
      where: { tenantId: tenant.tenantId, id, failures: expectedFailures, spentAt: null },
      data: {
        failures: expectedFailures + 1,
        ...(spentAt === null ? {} : { spentAt: dateOf(spentAt) }),
      },
    });
    return count === 1;
  }

  async spendCode(
    tenant: TenantContext,
    id: Id<'PortalCode'>,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).portalCode.updateMany({
      where: { tenantId: tenant.tenantId, id, spentAt: null },
      data: { spentAt: dateOf(at) },
    });
    return count === 1;
  }

  async pruneCodes(tenant: TenantContext, before: Temporal.Instant): Promise<number> {
    const { count } = await this.prisma.tx(tenant).portalCode.deleteMany({
      where: { tenantId: tenant.tenantId, expiresAt: { lt: dateOf(before) } },
    });
    return count;
  }

  async findByAddress(
    tenant: TenantContext,
    kind: PortalMethod,
    lookupHash: Buffer,
  ): Promise<PortalAccountRef | null> {
    const row = await this.prisma.tx(tenant).portalContact.findUnique({
      where: {
        tenantId_kind_lookupHash: {
          tenantId: tenant.tenantId,
          kind,
          lookupHash: new Uint8Array(lookupHash),
        },
        tenantId: tenant.tenantId,
      },
      select: { accountId: true, account: { select: { status: true, population: true } } },
    });
    if (row === null || row.account.population !== PORTAL) return null;
    return {
      accountId: row.accountId as Id<'Account'>,
      status: row.account.status as AccountStatus,
    };
  }

  async insertAccount(
    tenant: TenantContext,
    account: {
      readonly id: Id<'Account'>;
      readonly kind: PortalMethod;
      readonly lookupHash: Buffer;
      readonly sealed: Buffer;
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'> {
    const tx = this.prisma.tx(tenant);
    await tx.account.create({
      data: {
        tenantId: tenant.tenantId,
        id: account.id,
        population: PORTAL,
        source: PORTAL_ACCOUNT_SOURCE,
        subject: null,
        username: null,
        status: 'active',
        version: 1,
        createdAt: dateOf(at),
        updatedAt: dateOf(at),
      },
    });
    try {
      await tx.portalContact.create({
        data: {
          tenantId: tenant.tenantId,
          accountId: account.id,
          kind: account.kind,
          lookupHash: new Uint8Array(account.lookupHash),
          sealed: new Uint8Array(account.sealed),
          createdAt: dateOf(at),
        },
      });
    } catch (error) {
      // The unit rolls back on `taken` (the use case answers an error), the account row too.
      if (this.prisma.violatedConstraint(error) === UNIQUE_ADDRESS) return 'taken';
      throw error;
    }
    return 'created';
  }

  async findAccount(tenant: TenantContext, id: Id<'Account'>): Promise<PortalAccountRecord | null> {
    const row = await this.prisma.tx(tenant).account.findUnique({
      where: {
        tenantId_id: { tenantId: tenant.tenantId, id },
        tenantId: tenant.tenantId,
        population: PORTAL,
      },
      select: {
        id: true,
        status: true,
        contacts: { select: { kind: true, sealed: true }, orderBy: [{ kind: 'asc' }] },
      },
    });
    if (row === null) return null;
    return {
      accountId: row.id as Id<'Account'>,
      status: row.status as AccountStatus,
      contacts: row.contacts.map((contact) => ({
        kind: contact.kind as PortalMethod,
        sealed: Buffer.from(contact.sealed),
      })),
    };
  }
}
