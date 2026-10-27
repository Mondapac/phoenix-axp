// SPIKE (PoC 2): binds the gate with identity's AuthorisationCheck (identity's module is global
// and exports AUTHORISATION_CHECK; platform never imports a module).
import { Global, Module } from '@nestjs/common';
import { TenantRegistry } from '../tenant-config/tenant-registry';
import { AUTHORISATION_CHECK, type AuthorisationCheck } from './authorisation-check';
import { createUseCaseGate, USE_CASE_GATE } from './use-case-gate';

@Global()
@Module({
  providers: [
    {
      provide: USE_CASE_GATE,
      inject: [TenantRegistry, { token: AUTHORISATION_CHECK, optional: true }],
      useFactory: (tenants: TenantRegistry, check?: AuthorisationCheck) =>
        createUseCaseGate(tenants, check ?? null),
    },
  ],
  exports: [USE_CASE_GATE],
})
export class AuthzModule {}
