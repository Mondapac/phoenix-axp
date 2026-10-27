import { Injectable } from '@nestjs/common';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, TenantContext } from '@phoenix/shared-kernel';
import type { FieldMode, RoleKind, RoleScope } from '../../../platform/authz';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { StaleAggregateError } from '../../../platform/unit-of-work/errors';
import type {
  AssignmentRecord,
  DefinitionScopeChange,
  FieldRuleRecord,
  RoleRecord,
  RoleRepository,
} from '../application/roles/role.repository';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

const DEFINITION_SCOPES = {
  select: { permissionKey: true, allDefinitions: true, definitionIds: true },
  orderBy: { permissionKey: 'asc' },
} as const;

const FIELD_RULE = { definitionId: true, fieldId: true, mode: true } as const;

const ROLE = {
  id: true,
  key: true,
  kind: true,
  scope: true,
  permissionKeys: true,
  version: true,
  definitionScopes: DEFINITION_SCOPES,
} as const;

/** A role with every field rule, for grant decisions. */
const ROLE_WITH_RULES = {
  ...ROLE,
  fieldRules: { select: FIELD_RULE, orderBy: { fieldId: 'asc' } },
} as const;

const ASSIGNMENT = {
  id: true,
  accountId: true,
  level: true,
  siteId: true,
  includeDescendants: true,
  createdAt: true,
  role: { select: ROLE_WITH_RULES },
} as const;

/** Roles and their grants in `identity.role` and `identity.role_assignment`. */
@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext): Promise<RoleRecord[]> {
    const rows = await this.prisma.tx(tenant).role.findMany({
      where: { tenantId: tenant.tenantId },
      select: ROLE,
      orderBy: [{ key: 'asc' }],
    });
    return rows.map(roleOf);
  }

  async find(tenant: TenantContext, id: Id<'Role'>): Promise<RoleRecord | null> {
    const row = await this.prisma.tx(tenant).role.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: ROLE_WITH_RULES,
    });
    return row === null ? null : roleOf(row);
  }

  async findTenantSystemRole(tenant: TenantContext): Promise<RoleRecord | null> {
    const row = await this.prisma.tx(tenant).role.findFirst({
      where: { tenantId: tenant.tenantId, kind: 'system', scope: 'tenant' },
      select: ROLE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row === null ? null : roleOf(row);
  }

  async insertTenantSystemRole(
    tenant: TenantContext,
    role: { readonly id: Id<'Role'>; readonly key: string },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'> {
    try {
      await this.prisma.tx(tenant).role.create({
        data: {
          tenantId: tenant.tenantId,
          id: role.id,
          key: role.key,
          kind: 'system',
          scope: 'tenant',
          permissionKeys: [],
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'role_tenant_id_key_key') return 'taken';
      throw error;
    }
  }

  async insertCustom(
    tenant: TenantContext,
    role: {
      readonly id: Id<'Role'>;
      readonly key: string;
      readonly scope: RoleScope;
      readonly permissionKeys: readonly string[];
    },
    at: Temporal.Instant,
  ): Promise<'created' | 'taken'> {
    try {
      await this.prisma.tx(tenant).role.create({
        data: {
          tenantId: tenant.tenantId,
          id: role.id,
          key: role.key,
          kind: 'custom',
          scope: role.scope,
          permissionKeys: [...role.permissionKeys],
          version: 1,
          createdAt: dateOf(at),
          updatedAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (this.prisma.violatedConstraint(error) === 'role_tenant_id_key_key') return 'taken';
      throw error;
    }
  }

  async changePermissionKeys(
    tenant: TenantContext,
    id: Id<'Role'>,
    expectedVersion: number,
    permissionKeys: readonly string[],
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).role.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: {
        permissionKeys: [...permissionKeys],
        version: { increment: 1 },
        updatedAt: dateOf(at),
      },
    });
    if (count === 0) throw new StaleAggregateError('identity.role', id);
    // A key taken away takes its qualifier along: re-adding it starts with none (security
    // review of slice 2.0, L3).
    await this.prisma.tx(tenant).roleDefinitionScope.deleteMany({
      where: {
        tenantId: tenant.tenantId,
        roleId: id,
        permissionKey: { notIn: [...permissionKeys] },
      },
    });
  }

  async changeDefinitionScope(
    tenant: TenantContext,
    id: Id<'Role'>,
    expectedVersion: number,
    permissionKey: string,
    scope: DefinitionScopeChange,
    at: Temporal.Instant,
  ): Promise<void> {
    const tx = this.prisma.tx(tenant);
    await this.bumpVersion(tenant, id, expectedVersion, at);
    // Replaced by delete and insert: an upsert by key is refused by the tenant guard.
    await tx.roleDefinitionScope.deleteMany({
      where: { tenantId: tenant.tenantId, roleId: id, permissionKey },
    });
    if (scope === null) return;
    await tx.roleDefinitionScope.create({
      data: {
        tenantId: tenant.tenantId,
        roleId: id,
        permissionKey,
        allDefinitions: scope.allDefinitions,
        definitionIds: [...scope.definitionIds],
      },
    });
  }

  async replaceFieldRules(
    tenant: TenantContext,
    id: Id<'Role'>,
    expectedVersion: number,
    definitionId: Id<'Definition'>,
    rules: readonly Omit<FieldRuleRecord, 'definitionId'>[],
    at: Temporal.Instant,
  ): Promise<void> {
    const tx = this.prisma.tx(tenant);
    await this.bumpVersion(tenant, id, expectedVersion, at);
    await tx.roleFieldRule.deleteMany({
      where: { tenantId: tenant.tenantId, roleId: id, definitionId },
    });
    if (rules.length === 0) return;
    await tx.roleFieldRule.createMany({
      data: rules.map((rule) => ({
        tenantId: tenant.tenantId,
        roleId: id,
        definitionId,
        fieldId: rule.fieldId,
        mode: rule.mode,
      })),
    });
  }

  async assignmentsForDefinition(
    tenant: TenantContext,
    accountId: Id<'Account'>,
    definitionId: Id<'Definition'>,
  ): Promise<AssignmentRecord[]> {
    const rows = await this.prisma.tx(tenant).roleAssignment.findMany({
      where: { tenantId: tenant.tenantId, accountId },
      select: {
        ...ASSIGNMENT,
        role: {
          select: {
            ...ROLE,
            fieldRules: {
              where: { tenantId: tenant.tenantId, definitionId },
              select: FIELD_RULE,
              orderBy: { fieldId: 'asc' },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(assignmentOf);
  }

  private async bumpVersion(
    tenant: TenantContext,
    id: Id<'Role'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<void> {
    const { count } = await this.prisma.tx(tenant).role.updateMany({
      where: { tenantId: tenant.tenantId, id, version: expectedVersion },
      data: { version: { increment: 1 }, updatedAt: dateOf(at) },
    });
    if (count === 0) throw new StaleAggregateError('identity.role', id);
  }

  async hasAssignments(tenant: TenantContext, roleId: Id<'Role'>): Promise<boolean> {
    const row = await this.prisma.tx(tenant).roleAssignment.findFirst({
      where: { tenantId: tenant.tenantId, roleId },
      select: { id: true },
    });
    return row !== null;
  }

  async assignmentsOf(
    tenant: TenantContext,
    accountId: Id<'Account'>,
  ): Promise<AssignmentRecord[]> {
    const rows = await this.prisma.tx(tenant).roleAssignment.findMany({
      where: { tenantId: tenant.tenantId, accountId },
      select: ASSIGNMENT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(assignmentOf);
  }

  async findAssignment(
    tenant: TenantContext,
    id: Id<'RoleAssignment'>,
  ): Promise<AssignmentRecord | null> {
    const row = await this.prisma.tx(tenant).roleAssignment.findUnique({
      where: { tenantId_id: { tenantId: tenant.tenantId, id }, tenantId: tenant.tenantId },
      select: ASSIGNMENT,
    });
    return row === null ? null : assignmentOf(row);
  }

  async insertAssignment(
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
  ): Promise<'created' | 'exists'> {
    try {
      await this.prisma.tx(tenant).roleAssignment.create({
        data: {
          tenantId: tenant.tenantId,
          id: assignment.id,
          accountId: assignment.accountId,
          roleId: assignment.roleId,
          level: assignment.level,
          siteId: assignment.siteId,
          includeDescendants: assignment.includeDescendants,
          createdAt: dateOf(at),
        },
      });
      return 'created';
    } catch (error) {
      if (
        this.prisma.violatedConstraint(error) ===
        'role_assignment_tenant_id_account_id_role_id_site_id_key'
      ) {
        return 'exists';
      }
      throw error;
    }
  }

  async deleteAssignment(tenant: TenantContext, id: Id<'RoleAssignment'>): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).roleAssignment.deleteMany({
      where: { tenantId: tenant.tenantId, id },
    });
    return count > 0;
  }

  async tenantSystemRoleHolders(tenant: TenantContext): Promise<Id<'Account'>[]> {
    const rows = await this.prisma.tx(tenant).roleAssignment.findMany({
      where: {
        tenantId: tenant.tenantId,
        level: 'tenant',
        role: { kind: 'system', scope: 'tenant' },
        account: { population: 'tenant-staff', status: 'active', subject: { not: null } },
      },
      select: { accountId: true },
    });
    return [...new Set(rows.map((row) => row.accountId as Id<'Account'>))];
  }
}

function roleOf(row: {
  id: string;
  key: string;
  kind: string;
  scope: string;
  permissionKeys: string[];
  version: number;
  definitionScopes: { permissionKey: string; allDefinitions: boolean; definitionIds: string[] }[];
  fieldRules?: { definitionId: string; fieldId: string; mode: string }[];
}): RoleRecord {
  return {
    id: row.id as Id<'Role'>,
    key: row.key,
    kind: row.kind as RoleKind,
    scope: row.scope as RoleScope,
    permissionKeys: row.permissionKeys,
    version: row.version,
    definitionScopes: row.definitionScopes.map((scope) => ({
      permissionKey: scope.permissionKey,
      allDefinitions: scope.allDefinitions,
      definitionIds: scope.definitionIds as Id<'Definition'>[],
    })),
    ...(row.fieldRules === undefined
      ? {}
      : {
          fieldRules: row.fieldRules.map((rule) => ({
            definitionId: rule.definitionId as Id<'Definition'>,
            fieldId: rule.fieldId as Id<'Field'>,
            mode: rule.mode as FieldMode,
          })),
        }),
  };
}

function assignmentOf(row: {
  id: string;
  accountId: string;
  level: string;
  siteId: string | null;
  includeDescendants: boolean;
  createdAt: Date;
  role: Parameters<typeof roleOf>[0];
}): AssignmentRecord {
  return {
    id: row.id as Id<'RoleAssignment'>,
    accountId: row.accountId as Id<'Account'>,
    level: row.level as RoleScope,
    siteId: row.siteId as Id<'Site'> | null,
    includeDescendants: row.includeDescendants,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
    role: roleOf(row.role),
  };
}
