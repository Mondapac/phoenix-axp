import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { RoleKind, RoleScope } from '../../../../platform/authz';

/** A role of the tenant (`identity.role`). */
export interface RoleRecord {
  readonly id: Id<'Role'>;
  readonly key: string;
  readonly kind: RoleKind;
  readonly scope: RoleScope;
  /** Empty for a system role, which holds every key of its scope by definition. */
  readonly permissionKeys: readonly string[];
  readonly version: number;
}

/** One role granted to an account (`identity.role_assignment`), with its role. */
export interface AssignmentRecord {
  readonly id: Id<'RoleAssignment'>;
  readonly accountId: Id<'Account'>;
  readonly level: RoleScope;
  readonly siteId: Id<'Site'> | null;
  readonly includeDescendants: boolean;
  readonly createdAt: Temporal.Instant;
  readonly role: RoleRecord;
}

/** The roles of one tenant and their grants. Every method runs inside a unit. */
export interface RoleRepository {
  /** Every role of the tenant, by key. */
  list(tenant: TenantContext): Promise<RoleRecord[]>;
  find(tenant: TenantContext, id: Id<'Role'>): Promise<RoleRecord | null>;
  /** The tenant's system role of tenant scope (the oldest, should there be several), or null. */
  findTenantSystemRole(tenant: TenantContext): Promise<RoleRecord | null>;
  /**
   * The tenant's system role of tenant scope, at version 1, with no keys (it holds its scope);
   * `taken` when the tenant has a role of that key.
   */
  insertTenantSystemRole(
    tenant: TenantContext,
    role: { readonly id: Id<'Role'>; readonly key: string },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'>;
  /** A custom role at version 1; `taken` when the tenant has a role of that key. */
  insertCustom(
    tenant: TenantContext,
    role: {
      readonly id: Id<'Role'>;
      readonly key: string;
      readonly scope: RoleScope;
      readonly permissionKeys: readonly string[];
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'>;
  /** Replaces the keys of a role still at `expectedVersion`; StaleAggregateError otherwise. */
  changePermissionKeys(
    tenant: TenantContext,
    id: Id<'Role'>,
    expectedVersion: number,
    permissionKeys: readonly string[],
    at: Temporal.Instant,
  ): Promise<void>;
  /** True when the role is granted to any account. */
  hasAssignments(tenant: TenantContext, roleId: Id<'Role'>): Promise<boolean>;
  /** The grants of an account, oldest first. */
  assignmentsOf(tenant: TenantContext, accountId: Id<'Account'>): Promise<AssignmentRecord[]>;
  findAssignment(tenant: TenantContext, id: Id<'RoleAssignment'>): Promise<AssignmentRecord | null>;
  /** `exists` when the account already holds the role at that place. */
  insertAssignment(
    tenant: TenantContext,
    assignment: {
      readonly id: Id<'RoleAssignment'>;
      readonly accountId: Id<'Account'>;
      readonly roleId: Id<'Role'>;
      readonly level: RoleScope;
      readonly siteId: Id<'Site'> | null;
      readonly includeDescendants: boolean;
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'exists'>;
  /** False when there was no such grant. */
  deleteAssignment(tenant: TenantContext, id: Id<'RoleAssignment'>): Promise<boolean>;
  /**
   * The accounts that hold the tenant's system role and can sign in: tenant staff, active, and
   * linked to a subject (a local account that never signed in cannot). For LastHolderPolicy.
   */
  tenantSystemRoleHolders(tenant: TenantContext): Promise<Id<'Account'>[]>;
}

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
