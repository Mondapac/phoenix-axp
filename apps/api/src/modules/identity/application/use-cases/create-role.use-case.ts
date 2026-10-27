import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type NotGrantable,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLES_MANAGE } from '../../contracts/permissions';
import { ROLE_CREATED } from '../../domain/audit-actions';
import {
  parseRoleKey,
  TENANT_SYSTEM_ROLE_KEY,
  parseRolePermissionKeys,
  type CustomRoleScope,
  type InvalidRoleValue,
} from '../../domain/role';
import type { RoleKeyTaken } from '../failures';
import { keyFitsRole, type KeyCatalogue } from '../roles/acting-assignments';
import { canDefineRole } from '../roles/role-definition';
import type { RoleRepository } from '../roles/role.repository';

export interface CreateRoleInput {
  readonly key: string;
  readonly scope: CustomRoleScope;
  readonly permissionKeys: readonly string[];
}

export type CreateRoleFailure = InvalidRoleValue | RoleKeyTaken | NotGrantable;

/**
 * Defines a custom role (ADR-0004 decision 7): a tenant role (tenant and site keys, for the
 * whole tenant) or a site role (site keys, granted on a site). It confers only keys its author
 * holds, and a protected key only when the author holds the system role.
 */
export class CreateRole extends UseCase<CreateRoleInput, { id: Id<'Role'> }, CreateRoleFailure> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.create-role',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly roles: RoleRepository,
    private readonly catalogue: KeyCatalogue,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: CreateRoleInput,
  ): Promise<Result<{ id: Id<'Role'> }, CreateRoleFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') {
      return Promise.resolve(err({ code: 'role.not-grantable', reason: 'scope' } as const));
    }
    const key = parseRoleKey(input.key);
    if (!key.ok) return Promise.resolve(key);
    // The system role's seed key stays free for the first-administrator command.
    if (key.value === TENANT_SYSTEM_ROLE_KEY) {
      return Promise.resolve(err({ code: 'identity.role.key-taken' } as const));
    }
    const keys = parseRolePermissionKeys(input.permissionKeys, (k) =>
      keyFitsRole(k, input.scope, this.catalogue),
    );
    if (!keys.ok) return Promise.resolve(keys);
    const id = this.ids.next<'Role'>();
    return this.unitOfWork.run<{ id: Id<'Role'> }, CreateRoleFailure>(
      tenant,
      async () => {
        const allowed = canDefineRole(
          actor,
          await this.roles.assignmentsOf(tenant, actor.accountId),
          IDENTITY_ROLES_MANAGE.key,
          keys.value,
          this.catalogue,
        );
        if (!allowed.ok) return allowed;
        const created = await this.roles.insertCustom(
          tenant,
          { id, key: key.value, scope: input.scope, permissionKeys: keys.value },
          this.clock.now(),
        );
        if (created === 'taken') return err({ code: 'identity.role.key-taken' } as const);
        await this.audit.record(
          context,
          ROLE_CREATED.entry(id, { after: { scope: input.scope, permissionKeys: keys.value } }),
        );
        return ok({ id });
      },
      { isolation: 'serializable' },
    );
  }
}
