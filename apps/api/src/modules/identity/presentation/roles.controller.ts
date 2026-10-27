import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { ChangeRoleDefinitionScope } from '../application/use-cases/change-role-definition-scope.use-case';
import { ChangeRoleFieldRules } from '../application/use-cases/change-role-field-rules.use-case';
import { ChangeRolePermissions } from '../application/use-cases/change-role-permissions.use-case';
import { CreateRole } from '../application/use-cases/create-role.use-case';
import { ListPermissions } from '../application/use-cases/list-permissions.use-case';
import { ListRoles } from '../application/use-cases/list-roles.use-case';
import { ViewRoleFieldRules } from '../application/use-cases/view-role-field-rules.use-case';
import {
  CUSTOM_ROLE_SCOPES,
  MAX_FIELD_RULES,
  MAX_ROLE_PERMISSION_KEYS,
  MAX_ROLE_QUALIFIER_DEFINITIONS,
  ROLE_FIELD_MODES,
} from '../domain/role';
import { answer, idField, idParam, parseRequest } from './http';

const keys = z.array(z.string().max(128)).max(MAX_ROLE_PERMISSION_KEYS);
const createBody = z.strictObject({
  key: z.string().max(128),
  scope: z.enum(CUSTOM_ROLE_SCOPES),
  permissionKeys: keys,
});
const changeBody = z.strictObject({
  version: z.number().int().min(1),
  permissionKeys: keys,
});

const definitionScopeBody = z.strictObject({
  version: z.number().int().min(1),
  definitions: z.union([
    z.enum(['all', 'none']),
    z.array(idField<'Definition'>()).max(MAX_ROLE_QUALIFIER_DEFINITIONS),
  ]),
});
const fieldRulesBody = z.strictObject({
  version: z.number().int().min(1),
  rules: z
    .array(z.strictObject({ fieldId: idField<'Field'>(), mode: z.enum(ROLE_FIELD_MODES) }))
    .max(MAX_FIELD_RULES),
});

/** The tenant's roles and the permission catalogue they draw from (studio API). */
@ApiTags('identity')
@Controller('identity')
export class RolesController {
  constructor(
    private readonly listRoles: ListRoles,
    private readonly listPermissions: ListPermissions,
    private readonly createRole: CreateRole,
    private readonly changeRolePermissions: ChangeRolePermissions,
    private readonly changeRoleDefinitionScope: ChangeRoleDefinitionScope,
    private readonly viewRoleFieldRules: ViewRoleFieldRules,
    private readonly changeRoleFieldRules: ChangeRoleFieldRules,
  ) {}

  /** The roles with the qualifiers of their qualified keys; field rules are read per definition. */
  @Get('roles')
  async roles(@Call() context: CallContext) {
    const roles = answer(await this.listRoles.execute(context, undefined));
    return {
      items: roles.map((role) => ({
        id: role.id,
        key: role.key,
        kind: role.kind,
        scope: role.scope,
        permissionKeys: role.permissionKeys,
        version: role.version,
        definitionScopes: (role.definitionScopes ?? []).map((scope) => ({
          permissionKey: scope.permissionKey,
          definitions: scope.allDefinitions ? 'all' : scope.definitionIds,
        })),
      })),
    };
  }

  @Get('permissions')
  async permissions(@Call() context: CallContext) {
    const declarations = answer(await this.listPermissions.execute(context, undefined));
    return {
      items: declarations.map((d) => ({
        key: d.key,
        scope: d.scope,
        protected: d.protected,
        ...(d.qualifier === undefined ? {} : { qualifier: d.qualifier }),
      })),
    };
  }

  @Post('roles')
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.createRole.execute(context, parseRequest(createBody, body)));
  }

  /** Replaces the keys of a custom role. */
  @Put('roles/:roleId/permissions')
  async change(
    @Call() context: CallContext,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return answer(
      await this.changeRolePermissions.execute(context, {
        roleId: idParam<'Role'>(roleId, 'identity.role.not-found'),
        ...parseRequest(changeBody, body),
      }),
    );
  }

  /**
   * Sets which definitions one qualified key of a custom role applies to: `all` (later ones
   * included), a list of definition ids, or `none` (ADR-0024 decision 2).
   */
  @Put('roles/:roleId/definition-scopes/:permissionKey')
  async changeDefinitionScope(
    @Call() context: CallContext,
    @Param('roleId') roleId: string,
    @Param('permissionKey') permissionKey: string,
    @Body() body: unknown,
  ) {
    return answer(
      await this.changeRoleDefinitionScope.execute(context, {
        roleId: idParam<'Role'>(roleId, 'identity.role.not-found'),
        permissionKey,
        ...parseRequest(definitionScopeBody, body),
      }),
    );
  }

  /** The field rules of one definition of a role, with the role's version. */
  @Get('roles/:roleId/field-rules/:definitionId')
  async fieldRules(
    @Call() context: CallContext,
    @Param('roleId') roleId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return answer(
      await this.viewRoleFieldRules.execute(context, {
        roleId: idParam<'Role'>(roleId, 'identity.role.not-found'),
        definitionId: idParam<'Definition'>(definitionId, 'identity.role.not-found'),
      }),
    );
  }

  /** Replaces the field rules of one definition of a custom role (ADR-0024 decision 3). */
  @Put('roles/:roleId/field-rules/:definitionId')
  async changeFieldRules(
    @Call() context: CallContext,
    @Param('roleId') roleId: string,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ) {
    return answer(
      await this.changeRoleFieldRules.execute(context, {
        roleId: idParam<'Role'>(roleId, 'identity.role.not-found'),
        definitionId: idParam<'Definition'>(definitionId, 'identity.role.not-found'),
        ...parseRequest(fieldRulesBody, body),
      }),
    );
  }
}
