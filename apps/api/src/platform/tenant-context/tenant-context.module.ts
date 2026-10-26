import { Global, Module } from '@nestjs/common';
import { TenantContextFactory } from './tenant-context.factory';

/**
 * The tenant context of requests, jobs and events (ADR-02). Global, like the other platform
 * runtime modules; it exports the factory only. TenantContextGuard is registered by AppModule
 * in its APP_GUARD list.
 */
@Global()
@Module({
  providers: [TenantContextFactory],
  exports: [TenantContextFactory],
})
export class TenantContextModule {}
