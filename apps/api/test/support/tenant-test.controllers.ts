import { Controller, Get } from '@nestjs/common';
import type { CallContext, TenantContext } from '@phoenix/shared-kernel';
import { Call } from '../../src/platform/call-context/call-context.decorator';
import { NoTenantContext } from '../../src/platform/tenant-context/no-tenant-context.decorator';
import { Tenant } from '../../src/platform/tenant-context/tenant.decorator';

/** Test-only: a tenant-scoped controller that echoes what the guards resolved. */
@Controller('test/tenant')
export class TenantEchoController {
  @Get()
  echo(@Tenant() tenant: TenantContext): { tenantId: string } {
    return { tenantId: tenant.tenantId };
  }

  @Get('call')
  call(@Call() call: CallContext): { tenantId: string; actor: string; correlationId: string } {
    return {
      tenantId: call.tenant.tenantId,
      actor: call.actor.kind,
      correlationId: call.correlationId,
    };
  }
}

/** Test-only: an exempt controller whose handler wrongly asks for the tenant. */
@NoTenantContext()
@Controller('test/exempt')
export class ExemptTenantReaderController {
  @Get()
  read(@Tenant() tenant: TenantContext): { tenantId: string } {
    return { tenantId: tenant.tenantId };
  }
}
