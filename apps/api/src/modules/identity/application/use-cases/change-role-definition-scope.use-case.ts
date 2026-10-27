import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type NotGrantable,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLES_MANAGE } from '../../contracts/permissions';
import { ROLE_DEFINITION_SCOPE_CHANGED, type QualifierCoverage } from '../../domain/audit-actions';
import { parseQualifierDefinitions, type InvalidRoleValue } from '../../domain/role';
import { ROLE_NOT_FOUND, type RoleNotEditable, type RoleNotFound } from '../failures';
import {
  definitionAccessOf,
  effectiveKeysOf,
  type KeyCatalogue,
} from '../roles/acting-assignments';
import { canDefineRole } from '../roles/role-definition';
import type { DefinitionScopeRecord, RoleRepository } from '../roles/role.repository';

export interface ChangeRoleDefinitionScopeInput {
  readonly roleId: Id<'Role'>;
  readonly version: number;
  readonly permissionKey: string;
  /** `all` definitions (later ones included), the listed ones, or `none` (no qualifier). */
  readonly definitions: 'all' | 'none' | readonly Id<'Definition'>[];
}

export type ChangeRoleDefinitionScopeFailure =
  InvalidRoleValue | RoleNotFound | RoleNotEditable | NotGrantable;

const coverageOf = (scope: DefinitionScopeRecord | undefined): QualifierCoverage =>
  scope === undefined ? 'none' : scope.allDefinitions ? 'all' : 'listed';

const auditSide = (permissionKey: string, scope: DefinitionScopeRecord | undefined) => ({
  permissionKey,
  coverage: coverageOf(scope),
  definitionIds: [...(scope?.definitionIds ?? [])],
});

/**
 * Sets which definitions one qualified key of a custom role applies to (ADR-0024 decision 2):
 * all, a list, or none. The key must be one the role confers and the registry declares as
 * qualified. Like a change of keys, the author holds the role before and after under one tenant
 * grant, its qualifiers and field modes no wider than that grant's (decision 10); a role that
 * has holders is changed only by a system role holder.
 */
export class ChangeRoleDefinitionScope extends UseCase<
  ChangeRoleDefinitionScopeInput,
  void,
  ChangeRoleDefinitionScopeFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.change-role-definition-scope',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: ChangeRoleDefinitionScopeInput,
  ): Promise<Result<void, ChangeRoleDefinitionScopeFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') {
      return Promise.resolve(err({ code: 'role.not-grantable', reason: 'scope' } as const));
    }
    let after: DefinitionScopeRecord | null = null;
    if (input.definitions === 'all') {
      after = { permissionKey: input.permissionKey, allDefinitions: true, definitionIds: [] };
    } else if (input.definitions !== 'none') {
      const ids = parseQualifierDefinitions(input.definitions);
      if (!ids.ok) return Promise.resolve(ids);
      after = {
        permissionKey: input.permissionKey,
        allDefinitions: false,
        definitionIds: ids.value,
      };
    }
    return this.unitOfWork.run<void, ChangeRoleDefinitionScopeFailure>(
      tenant,
      async () => {
        const role = await this.roles.find(tenant, input.roleId);
        if (role === null) return err(ROLE_NOT_FOUND);
        if (role.kind !== 'custom') return err({ code: 'identity.role.not-editable' } as const);
        const keys = effectiveKeysOf(role, this.catalogue);
        if (
          !keys.has(input.permissionKey) ||
          this.catalogue.get(input.permissionKey)?.qualifier !== 'definition'
        ) {
          return err({ code: 'identity.value.invalid', field: 'permissionKey' } as const);
        }
        if (role.version !== input.version) throw new StaleAggregateError('identity.role', role.id);
        const scopes = role.definitionScopes ?? [];
        const before = scopes.find((scope) => scope.permissionKey === input.permissionKey);
        const changed = {
          ...role,
          definitionScopes: [
            ...scopes.filter((scope) => scope.permissionKey !== input.permissionKey),
            ...(after === null ? [] : [after]),
          ],
        };
        const assignments = await this.roles.assignmentsOf(tenant, actor.accountId);
        const systemRoleOnly = await this.roles.hasAssignments(tenant, role.id);
        for (const state of [role, changed]) {
          const allowed = canDefineRole(
            actor,
            assignments,
            IDENTITY_ROLES_MANAGE.key,
            [...keys],
            this.catalogue,
            systemRoleOnly,
            definitionAccessOf(state, this.catalogue),
          );
          if (!allowed.ok) return allowed;
        }
        await this.roles.changeDefinitionScope(
          tenant,
          role.id,
          role.version,
          input.permissionKey,
          after === null
            ? null
            : { allDefinitions: after.allDefinitions, definitionIds: after.definitionIds },
          this.clock.now(),
        );
        await this.audit.record(
          context,
          ROLE_DEFINITION_SCOPE_CHANGED.entry(role.id, {
            before: auditSide(input.permissionKey, before),
            after: auditSide(input.permissionKey, after ?? undefined),
          }),
        );
        return ok(undefined);
      },
      { isolation: 'serializable' },
    );
  }
}
