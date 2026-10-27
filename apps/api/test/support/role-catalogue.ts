// A fixed permission catalogue and role fixtures for identity's role-rule specs (no registry,
// no Nest).
import { Temporal } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { definePermission, type PermissionScope } from '../../src/platform/authz';
import type { KeyCatalogue } from '../../src/modules/identity/application/roles/acting-assignments';
import type {
  AssignmentRecord,
  RoleRecord,
} from '../../src/modules/identity/application/roles/role.repository';

const declare = (key: string, scope: PermissionScope, isProtected: boolean) =>
  definePermission(key.split('.')[0]!, { key, scope, protected: isProtected });
/** A key over run-time definitions (ADR-0024 decision 2). */
const qualified = (key: string) =>
  definePermission(key.split('.')[0]!, {
    key,
    scope: 'site',
    protected: false,
    qualifier: 'definition',
  });

const DECLARATIONS = [
  declare('identity.accounts.view', 'tenant', false),
  declare('identity.accounts.manage', 'tenant', true),
  declare('identity.roles.manage', 'tenant', true),
  declare('identity.role-assignments.manage', 'site', true),
  declare('content.items.edit', 'site', false),
  declare('content.items.publish', 'site', false),
  declare('platform.tenants.manage', 'platform', true),
  qualified('records.item.read'),
  qualified('records.item.update'),
];

export const testCatalogue: KeyCatalogue = {
  get: (key) => DECLARATIONS.find((d) => d.key === key),
  keysOf: (scope: PermissionScope) =>
    new Set(DECLARATIONS.filter((d) => d.scope === scope).map((d) => d.key)),
  isProtected: (key) => DECLARATIONS.find((d) => d.key === key)?.protected ?? true,
};

let sequence = 0;
const nextId = <K extends string>(): Id<K> =>
  `0190a000-0000-7000-8000-${String((sequence += 1)).padStart(12, '0')}` as Id<K>;

export function testRole(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return {
    id: nextId<'Role'>(),
    key: 'role',
    kind: 'custom',
    scope: 'tenant',
    permissionKeys: [],
    version: 1,
    ...overrides,
  };
}

export function testGrant(
  role: RoleRecord,
  overrides: Partial<Omit<AssignmentRecord, 'role'>> = {},
): AssignmentRecord {
  return {
    id: nextId<'RoleAssignment'>(),
    accountId: nextId<'Account'>(),
    level: role.scope,
    siteId: null,
    includeDescendants: false,
    createdAt: Temporal.Instant.from('2026-10-27T12:00:00Z'),
    role,
    ...overrides,
  };
}

export const testId = nextId;
