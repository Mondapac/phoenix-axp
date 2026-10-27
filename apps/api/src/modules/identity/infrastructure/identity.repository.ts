// SPIKE (PoC 2): identity's tables (schema "identity") through the guarded view. Every method
// runs inside a unit the caller opened; the tenant is always the unit's.
import { Injectable } from '@nestjs/common';
import type { Temporal, TenantContext } from '@phoenix/shared-kernel';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type {
  GrantRow,
  IdentityStore,
  StaffAccountRow,
  StaffSource,
} from '../application/ports/identity-store';

const toDate = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const ACCOUNT_FIELDS = {
  id: true,
  subject: true,
  username: true,
  source: true,
  status: true,
} as const;

@Injectable()
export class IdentityRepository implements IdentityStore {
  constructor(private readonly prisma: PrismaService) {}

  async accountBySubject(tenant: TenantContext, subject: string): Promise<StaffAccountRow | null> {
    return (await this.prisma.tx(tenant).staffAccount.findFirst({
      where: { tenantId: tenant.tenantId, subject },
      select: ACCOUNT_FIELDS,
    })) as StaffAccountRow | null;
  }

  async accountById(tenant: TenantContext, id: string): Promise<StaffAccountRow | null> {
    return (await this.prisma.tx(tenant).staffAccount.findFirst({
      where: { tenantId: tenant.tenantId, id },
      select: ACCOUNT_FIELDS,
    })) as StaffAccountRow | null;
  }

  async activeAccounts(tenant: TenantContext): Promise<StaffAccountRow[]> {
    return (await this.prisma.tx(tenant).staffAccount.findMany({
      where: { tenantId: tenant.tenantId, status: 'active' },
      select: ACCOUNT_FIELDS,
    })) as StaffAccountRow[];
  }

  async createAccount(
    tenant: TenantContext,
    row: {
      id: string;
      subject: string;
      username: string;
      source: StaffSource;
      createdAt: Temporal.Instant;
    },
  ): Promise<void> {
    await this.prisma.tx(tenant).staffAccount.create({
      data: {
        ...row,
        createdAt: toDate(row.createdAt),
        tenantId: tenant.tenantId,
        status: 'active',
        version: 1,
      },
    });
  }

  /** Disables the account and ends every core session of it, in the caller's unit. */
  async disableAccount(
    tenant: TenantContext,
    accountId: string,
    at: Temporal.Instant,
  ): Promise<{ disabled: boolean; sessionsEnded: number }> {
    const tx = this.prisma.tx(tenant);
    const updated = await tx.staffAccount.updateMany({
      where: { tenantId: tenant.tenantId, id: accountId, status: 'active' },
      data: { status: 'disabled', disabledAt: toDate(at), version: { increment: 1 } },
    });
    const ended = await tx.staffSession.deleteMany({
      where: { tenantId: tenant.tenantId, accountId },
    });
    return { disabled: updated.count === 1, sessionsEnded: ended.count };
  }

  async createSession(
    tenant: TenantContext,
    row: {
      id: string;
      accountId: string;
      tokenHash: Buffer;
      idpSessionId: string | null;
      createdAt: Temporal.Instant;
      expiresAt: Temporal.Instant;
    },
  ): Promise<void> {
    await this.prisma.tx(tenant).staffSession.create({
      data: {
        ...row,
        createdAt: toDate(row.createdAt),
        expiresAt: toDate(row.expiresAt),
        tokenHash: new Uint8Array(row.tokenHash),
        tenantId: tenant.tenantId,
      },
    });
  }

  /** The live session of a token hash, with its account's status; null when none. */
  async liveSession(
    tenant: TenantContext,
    tokenHash: Buffer,
    now: Temporal.Instant,
  ): Promise<{ id: string; accountId: string; accountStatus: string } | null> {
    const session = await this.prisma.tx(tenant).staffSession.findFirst({
      where: {
        tenantId: tenant.tenantId,
        tokenHash: new Uint8Array(tokenHash),
        expiresAt: { gt: toDate(now) },
      },
      select: { id: true, accountId: true, account: { select: { status: true } } },
    });
    return session === null
      ? null
      : { id: session.id, accountId: session.accountId, accountStatus: session.account.status };
  }

  async endSessionsByIdpSession(tenant: TenantContext, idpSessionId: string): Promise<number> {
    const ended = await this.prisma.tx(tenant).staffSession.deleteMany({
      where: { tenantId: tenant.tenantId, idpSessionId },
    });
    return ended.count;
  }

  async endSessionsOfAccount(tenant: TenantContext, accountId: string): Promise<number> {
    const ended = await this.prisma.tx(tenant).staffSession.deleteMany({
      where: { tenantId: tenant.tenantId, accountId },
    });
    return ended.count;
  }

  /** The account's grants with their roles' permission keys. */
  async grantsOf(tenant: TenantContext, accountId: string): Promise<GrantRow[]> {
    const grants = await this.prisma.tx(tenant).roleGrant.findMany({
      where: { tenantId: tenant.tenantId, principalId: accountId },
      select: {
        id: true,
        siteId: true,
        includeDescendants: true,
        role: { select: { permissions: true } },
      },
    });
    return grants.map((grant) => ({
      id: grant.id,
      siteId: grant.siteId,
      includeDescendants: grant.includeDescendants,
      permissions: grant.role.permissions,
    }));
  }

  async deleteGrant(tenant: TenantContext, grantId: string): Promise<boolean> {
    const deleted = await this.prisma.tx(tenant).roleGrant.deleteMany({
      where: { tenantId: tenant.tenantId, id: grantId },
    });
    return deleted.count === 1;
  }
}
