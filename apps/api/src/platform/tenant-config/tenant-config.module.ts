import { Global, Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { loadTenantConfigs } from './tenant-config';
import { TenantRegistry } from './tenant-registry';

/** Loads and validates tenant configuration at start-up; invalid configuration stops the boot. */
@Global()
@Module({
  providers: [
    {
      provide: TenantRegistry,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new TenantRegistry(loadTenantConfigs(config.tenantConfigDirs, config.hostedTenants)),
    },
  ],
  exports: [TenantRegistry],
})
export class TenantConfigModule {}
