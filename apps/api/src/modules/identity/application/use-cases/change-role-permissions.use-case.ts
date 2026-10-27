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
import { ROLE_PERMISSIONS_CHANGED } from '../../domain/audit-actions';
import { parseRolePermissionKeys, type InvalidRoleValue } from '../../domain/role';
import { ROLE_NOT_FOUND, type RoleNotEditable, type RoleNotFound } from '../failures';
import { definitionAccessOf, keyFitsRole, type KeyCatalogue } from '../roles/acting-assignments';
import { canDefineRole } from '../roles/role-definition';
import type { RoleRepository } from '../roles/role.repository';

export interface ChangeRolePermissionsInput {
  readonly roleId: Id<'Role'>;
  readonly version: number;
  readonly permissionKeys: readonly string[];
}

export type ChangeRolePermissionsFailure =
  InvalidRoleValue | RoleNotFound | RoleNotEditable | NotGrantable;

/**
 * Replaces the keys a custom role confers. Every holder gains or loses them on their next
 * request (nothing is cached). The author must hold every key of the role, before and after:
 * nobody reshapes a role beyond their own reach. A role that has holders is changed only by a
 * system role holder, since its holders may outrank the author (security review, M1).
 */
export class ChangeRolePermissions extends UseCase<
  ChangeRolePermissionsInput,
  void,
  ChangeRolePermissionsFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.change-role-permissions',
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
    input: ChangeRolePermissionsInput,
  ): Promise<Result<void, ChangeRolePermissionsFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') {
      return Promise.resolve(err({ code: 'role.not-grantable', reason: 'scope' } as const));
    }
    return this.unitOfWork.run<void, ChangeRolePermissionsFailure>(
      tenant,
      async () => {
        const role = await this.roles.find(tenant, input.roleId);
        if (role === null) return err(ROLE_NOT_FOUND);
        if (role.kind !== 'custom') return err({ code: 'identity.role.not-editable' } as const);
        const keys = parseRolePermissionKeys(input.permissionKeys, (k) =>
          keyFitsRole(k, role.scope, this.catalogue),
        );
        if (!keys.ok) return keys;
        if (role.version !== input.version) throw new StaleAggregateError('identity.role', role.id);
        // A key no longer declared confers nothing and may be dropped by anyone allowed here.
        const previous = role.permissionKeys.filter((k) => this.catalogue.get(k) !== undefined);
        const allowed = canDefineRole(
          actor,
          await this.roles.assignmentsOf(tenant, actor.accountId),
          IDENTITY_ROLES_MANAGE.key,
          [...new Set([...previous, ...keys.value])],
          this.catalogue,
          await this.roles.hasAssignments(tenant, role.id),
          // A stored qualifier comes back into force with its key (ADR-0024 decision 10).
          definitionAccessOf({ ...role, permissionKeys: keys.value }, this.catalogue),
        );
        if (!allowed.ok) return allowed;
        await this.roles.changePermissionKeys(
          tenant,
          role.id,
          role.version,
          keys.value,
          this.clock.now(),
        );
        await this.audit.record(
          context,
          ROLE_PERMISSIONS_CHANGED.entry(role.id, {
            before: { permissionKeys: previous },
            after: { permissionKeys: keys.value },
          }),
        );
        return ok(undefined);
      },
      { isolation: 'serializable' },
    );
  }
}
