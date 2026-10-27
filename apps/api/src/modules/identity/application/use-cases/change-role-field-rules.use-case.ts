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
import { ROLE_FIELD_RULES_CHANGED } from '../../domain/audit-actions';
import {
  MAX_RULED_DEFINITIONS,
  parseFieldRules,
  type FieldRuleValue,
  type InvalidRoleValue,
} from '../../domain/role';
import { ROLE_NOT_FOUND, type RoleNotEditable, type RoleNotFound } from '../failures';
import {
  definitionAccessOf,
  effectiveKeysOf,
  type KeyCatalogue,
} from '../roles/acting-assignments';
import { canDefineRole } from '../roles/role-definition';
import type { FieldRuleRecord, RoleRepository } from '../roles/role.repository';

export interface ChangeRoleFieldRulesInput {
  readonly roleId: Id<'Role'>;
  readonly version: number;
  readonly definitionId: Id<'Definition'>;
  /** Every rule the role keeps for the definition; an empty list removes them all. */
  readonly rules: readonly FieldRuleValue[];
}

export type ChangeRoleFieldRulesFailure =
  InvalidRoleValue | RoleNotFound | RoleNotEditable | NotGrantable;

const auditSide = (definitionId: Id<'Definition'>, rules: readonly FieldRuleValue[]) => ({
  definitionId,
  hidden: rules.filter((rule) => rule.mode === 'hidden').map((rule) => rule.fieldId),
  read: rules.filter((rule) => rule.mode === 'read').map((rule) => rule.fieldId),
  edit: rules.filter((rule) => rule.mode === 'edit').map((rule) => rule.fieldId),
});

/**
 * Replaces the field rules (`hidden`, `read`, `edit` by stable field id) of one definition of a
 * custom role (ADR-0024 decision 3). The fields are the definition module's: an id that names
 * no field is hidden anyway. The author holds the role before and after under one tenant
 * grant, its field modes no wider than that grant's (decision 10); a role that has holders is
 * changed only by a system role holder. Every holder sees the change on their next request.
 */
export class ChangeRoleFieldRules extends UseCase<
  ChangeRoleFieldRulesInput,
  void,
  ChangeRoleFieldRulesFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.change-role-field-rules',
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
    input: ChangeRoleFieldRulesInput,
  ): Promise<Result<void, ChangeRoleFieldRulesFailure>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') {
      return Promise.resolve(err({ code: 'role.not-grantable', reason: 'scope' } as const));
    }
    const rules = parseFieldRules(input.rules);
    if (!rules.ok) return Promise.resolve(rules);
    const { definitionId } = input;
    return this.unitOfWork.run<void, ChangeRoleFieldRulesFailure>(
      tenant,
      async () => {
        const role = await this.roles.find(tenant, input.roleId);
        if (role === null) return err(ROLE_NOT_FOUND);
        if (role.kind !== 'custom') return err({ code: 'identity.role.not-editable' } as const);
        if (role.version !== input.version) throw new StaleAggregateError('identity.role', role.id);
        const stored = role.fieldRules ?? [];
        const before = stored.filter((rule) => rule.definitionId === definitionId);
        const changed = {
          ...role,
          fieldRules: [
            ...stored.filter((rule) => rule.definitionId !== definitionId),
            ...rules.value.map((rule): FieldRuleRecord => ({ ...rule, definitionId })),
          ],
        };
        if (
          new Set(changed.fieldRules.map((rule) => rule.definitionId)).size > MAX_RULED_DEFINITIONS
        ) {
          return err({ code: 'identity.value.invalid', field: 'fieldRules' } as const);
        }
        const assignments = await this.roles.assignmentsOf(tenant, actor.accountId);
        const systemRoleOnly = await this.roles.hasAssignments(tenant, role.id);
        const keys = [...effectiveKeysOf(role, this.catalogue)];
        for (const state of [role, changed]) {
          const allowed = canDefineRole(
            actor,
            assignments,
            IDENTITY_ROLES_MANAGE.key,
            keys,
            this.catalogue,
            systemRoleOnly,
            definitionAccessOf(state, this.catalogue),
          );
          if (!allowed.ok) return allowed;
        }
        await this.roles.replaceFieldRules(
          tenant,
          role.id,
          role.version,
          definitionId,
          rules.value,
          this.clock.now(),
        );
        await this.audit.record(
          context,
          ROLE_FIELD_RULES_CHANGED.entry(role.id, {
            before: auditSide(definitionId, before),
            after: auditSide(definitionId, rules.value),
          }),
        );
        return ok(undefined);
      },
      { isolation: 'serializable' },
    );
  }
}
