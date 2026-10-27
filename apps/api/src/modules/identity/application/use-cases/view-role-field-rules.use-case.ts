import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ROLES_VIEW } from '../../contracts/permissions';
import type { FieldRuleValue } from '../../domain/role';
import { ROLE_NOT_FOUND, type RoleNotFound } from '../failures';
import type { RoleRepository } from '../roles/role.repository';

export interface ViewRoleFieldRulesInput {
  readonly roleId: Id<'Role'>;
  readonly definitionId: Id<'Definition'>;
}

/** A role's version (for the next change) and its rules of one definition, by field id. */
export interface RoleFieldRulesView {
  readonly version: number;
  readonly rules: readonly FieldRuleValue[];
}

/** The field rules of one definition of a role (ADR-0024 decision 3), for studio. */
export class ViewRoleFieldRules extends UseCase<
  ViewRoleFieldRulesInput,
  RoleFieldRulesView,
  RoleNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-role-field-rules',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly roles: RoleRepository,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: ViewRoleFieldRulesInput,
  ): Promise<Result<RoleFieldRulesView, RoleNotFound>> {
    const { tenant } = context;
    return this.unitOfWork.run<RoleFieldRulesView, RoleNotFound>(
      tenant,
      async () => {
        const role = await this.roles.find(tenant, input.roleId);
        if (role === null) return err(ROLE_NOT_FOUND);
        return ok({
          version: role.version,
          rules: (role.fieldRules ?? [])
            .filter((rule) => rule.definitionId === input.definitionId)
            .map((rule) => ({ fieldId: rule.fieldId, mode: rule.mode })),
        });
      },
      { readOnly: true },
    );
  }
}
