import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { AssignRole } from '../application/use-cases/assign-role.use-case';
import { ListAccountRoleAssignments } from '../application/use-cases/list-account-role-assignments.use-case';
import { RevokeRoleAssignment } from '../application/use-cases/revoke-role-assignment.use-case';
import { answer, idField, idParam, parseRequest } from './http';

const assignBody = z.strictObject({
  accountId: idField<'Account'>(),
  roleId: idField<'Role'>(),
  placement: z.discriminatedUnion('level', [
    z.strictObject({ level: z.literal('tenant') }),
    z.strictObject({
      level: z.literal('site'),
      siteId: idField<'Site'>(),
      includeDescendants: z.boolean(),
    }),
  ]),
});

/** The roles granted to staff accounts (studio API; ADR-0018 decision 6). */
@ApiTags('identity')
@Controller('identity')
export class RoleAssignmentsController {
  constructor(
    private readonly listAccountRoleAssignments: ListAccountRoleAssignments,
    private readonly assignRole: AssignRole,
    private readonly revokeRoleAssignment: RevokeRoleAssignment,
  ) {}

  @Get('staff-accounts/:accountId/role-assignments')
  async list(@Call() context: CallContext, @Param('accountId') accountId: string) {
    const assignments = answer(
      await this.listAccountRoleAssignments.execute(context, {
        accountId: idParam<'Account'>(accountId, 'identity.account.not-found'),
      }),
    );
    return {
      items: assignments.map((a) => ({
        id: a.id,
        roleId: a.role.id,
        roleKey: a.role.key,
        level: a.level,
        siteId: a.siteId,
        includeDescendants: a.includeDescendants,
        createdAt: a.createdAt.toString(),
      })),
    };
  }

  @Post('role-assignments')
  async assign(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.assignRole.execute(context, parseRequest(assignBody, body)));
  }

  @Delete('role-assignments/:assignmentId')
  @HttpCode(204)
  async revoke(@Call() context: CallContext, @Param('assignmentId') assignmentId: string) {
    answer(
      await this.revokeRoleAssignment.execute(context, {
        assignmentId: idParam<'RoleAssignment'>(assignmentId, 'identity.role-assignment.not-found'),
      }),
    );
  }
}
