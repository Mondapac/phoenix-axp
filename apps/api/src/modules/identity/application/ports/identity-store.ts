// SPIKE (PoC 2): identity's persistence port; infrastructure/identity.repository.ts implements
// it. Every method runs inside a unit the caller opened.
import type { Temporal, TenantContext } from '@phoenix/shared-kernel';

export type StaffSource = 'directory' | 'local';

export interface StaffAccountRow {
  readonly id: string;
  readonly subject: string;
  readonly username: string;
  readonly source: StaffSource;
  readonly status: 'active' | 'disabled';
}

export interface GrantRow {
  readonly id: string;
  readonly siteId: string | null;
  readonly includeDescendants: boolean;
  readonly permissions: readonly string[];
}

export interface IdentityStore {
  accountBySubject(tenant: TenantContext, subject: string): Promise<StaffAccountRow | null>;
  accountById(tenant: TenantContext, id: string): Promise<StaffAccountRow | null>;
  activeAccounts(tenant: TenantContext): Promise<StaffAccountRow[]>;
  createAccount(
    tenant: TenantContext,
    row: {
      id: string;
      subject: string;
      username: string;
      source: StaffSource;
      createdAt: Temporal.Instant;
    },
  ): Promise<void>;
  disableAccount(
    tenant: TenantContext,
    accountId: string,
    at: Temporal.Instant,
  ): Promise<{ disabled: boolean; sessionsEnded: number }>;
  createSession(
    tenant: TenantContext,
    row: {
      id: string;
      accountId: string;
      tokenHash: Buffer;
      idpSessionId: string | null;
      createdAt: Temporal.Instant;
      expiresAt: Temporal.Instant;
    },
  ): Promise<void>;
  liveSession(
    tenant: TenantContext,
    tokenHash: Buffer,
    now: Temporal.Instant,
  ): Promise<{ id: string; accountId: string; accountStatus: string } | null>;
  endSessionsByIdpSession(tenant: TenantContext, idpSessionId: string): Promise<number>;
  endSessionsOfAccount(tenant: TenantContext, accountId: string): Promise<number>;
  grantsOf(tenant: TenantContext, accountId: string): Promise<GrantRow[]>;
  deleteGrant(tenant: TenantContext, grantId: string): Promise<boolean>;
}

export const IDENTITY_STORE = Symbol('IDENTITY_STORE');
