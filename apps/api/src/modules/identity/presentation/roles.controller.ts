import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { ChangeRolePermissions } from '../application/use-cases/change-role-permissions.use-case';
import { CreateRole } from '../application/use-cases/create-role.use-case';
import { ListPermissions } from '../application/use-cases/list-permissions.use-case';
import { ListRoles } from '../application/use-cases/list-roles.use-case';
import { CUSTOM_ROLE_SCOPES, MAX_ROLE_PERMISSION_KEYS } from '../domain/role';
import { answer, idParam, parseRequest } from './http';

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

/** The tenant's roles and the permission catalogue they draw from (studio API). */
@ApiTags('identity')
@Controller('identity')
export class RolesController {
  constructor(
    private readonly listRoles: ListRoles,
    private readonly listPermissions: ListPermissions,
    private readonly createRole: CreateRole,
    private readonly changeRolePermissions: ChangeRolePermissions,
  ) {}

  @Get('roles')
  async roles(@Call() context: CallContext) {
    return { items: answer(await this.listRoles.execute(context, undefined)) };
  }

  @Get('permissions')
  async permissions(@Call() context: CallContext) {
    const declarations = answer(await this.listPermissions.execute(context, undefined));
    return {
      items: declarations.map((d) => ({ key: d.key, scope: d.scope, protected: d.protected })),
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
}
