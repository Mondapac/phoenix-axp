import { Injectable } from '@nestjs/common';
import type { Id, Population, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { RoleKind, RoleScope } from '../../../platform/authz';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type {
  AssignedRole,
  LiveSession,
  SessionRepository,
} from '../application/session.repository';
import type { AccountStatus } from '../domain/account';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const LIVE = {
  id: true,
  accountId: true,
  account: { select: { population: true, status: true } },
} as const;

/** Sessions in `identity.session`, and the role assignments read with them. */
@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLive(
    tenant: TenantContext,
    tokenHash: Buffer,
    now: Temporal.Instant,
  ): Promise<LiveSession | null> {
    const row = await this.prisma.tx(tenant).session.findFirst({
      where: {
        tenantId: tenant.tenantId,
        tokenHash: new Uint8Array(tokenHash),
        expiresAt: { gt: dateOf(now) },
      },
      select: LIVE,
    });
    return row === null ? null : liveOf(row);
  }

  async findLiveById(
    tenant: TenantContext,
    sessionId: Id<'Session'>,
    accountId: Id<'Account'>,
    now: Temporal.Instant,
  ): Promise<LiveSession | null> {
    const row = await this.prisma.tx(tenant).session.findFirst({
      where: {
        tenantId: tenant.tenantId,
        id: sessionId,
        accountId,
        expiresAt: { gt: dateOf(now) },
      },
      select: LIVE,
    });
    return row === null ? null : liveOf(row);
  }

  async assignmentsOf(tenant: TenantContext, accountId: Id<'Account'>): Promise<AssignedRole[]> {
    const rows = await this.prisma.tx(tenant).roleAssignment.findMany({
      where: { tenantId: tenant.tenantId, accountId },
      select: {
        level: true,
        siteId: true,
        includeDescendants: true,
        role: { select: { kind: true, scope: true, permissionKeys: true } },
      },
    });
    return rows.map((row) => ({
      level: row.level as RoleScope,
      siteId: row.siteId as Id<'Site'> | null,
      includeDescendants: row.includeDescendants,
      roleKind: row.role.kind as RoleKind,
      roleScope: row.role.scope as RoleScope,
      permissionKeys: row.role.permissionKeys,
    }));
  }

  async insert(
    tenant: TenantContext,
    session: {
      readonly id: Id<'Session'>;
      readonly accountId: Id<'Account'>;
      readonly tokenHash: Buffer;
      readonly idpSessionId: string | null;
      readonly expiresAt: Temporal.Instant;
    },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).session.create({
      data: {
        tenantId: tenant.tenantId,
        id: session.id,
        accountId: session.accountId,
        tokenHash: new Uint8Array(session.tokenHash),
        idpSessionId: session.idpSessionId,
        createdAt: dateOf(at),
        expiresAt: dateOf(session.expiresAt),
      },
    });
  }

  async end(
    tenant: TenantContext,
    sessionId: Id<'Session'>,
    accountId: Id<'Account'>,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).session.deleteMany({
      where: { tenantId: tenant.tenantId, id: sessionId, accountId },
    });
    return count > 0;
  }

  async endAllOf(tenant: TenantContext, accountId: Id<'Account'>): Promise<number> {
    const { count } = await this.prisma.tx(tenant).session.deleteMany({
      where: { tenantId: tenant.tenantId, accountId },
    });
    return count;
  }
}

function liveOf(row: {
  id: string;
  accountId: string;
  account: { population: string; status: string };
}): LiveSession {
  return {
    sessionId: row.id as Id<'Session'>,
    accountId: row.accountId as Id<'Account'>,
    population: row.account.population as Population,
    accountStatus: row.account.status as AccountStatus,
  };
}
