// SPIKE (PoC 2): studio actions used by the criteria.
import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { CallContext } from '@phoenix/shared-kernel';
import { httpFailure } from '../../../platform/authz';
import { Call } from '../../../platform/call-context/call-context.decorator';
import {
  DisableLocalStaffAccount,
  RevokeRoleGrant,
} from '../application/use-cases/staff-admin.use-cases';

@Controller('spike/studio')
export class StudioAdminController {
  constructor(
    private readonly revokeRoleGrant: RevokeRoleGrant,
    private readonly disableLocalStaffAccount: DisableLocalStaffAccount,
  ) {}

  @Post('role-grants/:grantId/revoke')
  @HttpCode(200)
  async revoke(@Call() call: CallContext, @Param('grantId') grantId: string) {
    const result = await this.revokeRoleGrant.execute(call, { grantId });
    if (!result.ok) throw httpFailure(result.error, { 'grant.not-found': 404 });
    return result.value;
  }

  @Post('staff-accounts/:accountId/disable')
  @HttpCode(200)
  async disable(@Call() call: CallContext, @Param('accountId') accountId: string) {
    const result = await this.disableLocalStaffAccount.execute(call, { accountId });
    if (!result.ok)
      throw httpFailure(result.error, { 'account.not-found': 404, 'account.not-local': 409 });
    return result.value;
  }
}
