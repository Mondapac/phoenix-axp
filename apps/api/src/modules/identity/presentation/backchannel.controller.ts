// SPIKE (PoC 2): OIDC back-channel logout endpoint, called by Keycloak (server to server). The
// tenant is in the path because no BFF stands between Keycloak and the core here; it is still
// checked against HOSTED_TENANTS. The only credential is the logout token's signature.
// KNOWN RULE BREAK (spike only): this module mints a call context, which the
// contexts-are-minted-by-platform rule forbids. Phase 1 needs a platform entry adapter for
// IdP-to-core calls (tenant from the path, no actor) that hands the module a context.
import { Body, Controller, HttpCode, HttpException, Param, Post } from '@nestjs/common';
import { createCallContext, anonymousActor } from '@phoenix/shared-kernel/contexts';
import { parseCorrelationId } from '@phoenix/shared-kernel';
import { randomUUID } from 'node:crypto';
import { NoTenantContext } from '../../../platform/tenant-context/no-tenant-context.decorator';
import { TenantContextFactory } from '../../../platform/tenant-context/tenant-context.factory';
import { EndIdpSession } from '../application/use-cases/sign-in.use-cases';

@NoTenantContext()
@Controller('spike/backchannel')
export class BackchannelController {
  constructor(
    private readonly tenants: TenantContextFactory,
    private readonly endIdpSession: EndIdpSession,
  ) {}

  @Post(':tenantId/logout')
  @HttpCode(200)
  async logout(@Param('tenantId') tenantId: string, @Body() body: { logout_token?: unknown }) {
    const tenant = this.tenants.forTenant(tenantId);
    if (!tenant.ok) throw new HttpException({ statusCode: 400, code: 'logout.rejected' }, 400);
    const correlation = parseCorrelationId(`bcl-${randomUUID()}`);
    if (!correlation.ok) throw new Error('unreachable');
    const call = createCallContext(tenant.value, anonymousActor(tenant.value), correlation.value);
    const token = typeof body?.logout_token === 'string' ? body.logout_token : '';
    const result = await this.endIdpSession.execute(call, { logoutToken: token });
    if (!result.ok) throw new HttpException({ statusCode: 400, code: 'logout.rejected' }, 400);
    return {};
  }
}
