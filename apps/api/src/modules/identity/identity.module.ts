// SPIKE (PoC 2): the identity module: Keycloak sign-in, core sessions, the Authenticator and
// the AuthorisationCheck. Global, so platform/authz and other modules get its ports by token.
import { Global, Module } from '@nestjs/common';
import { AUTHENTICATOR, AUTHORISATION_CHECK } from '../../platform/authz';
import { IdentityAuthorisationCheck } from './application/identity-authorisation-check';
import {
  STAFF_DIRECTORY_ADMIN,
  STAFF_IDENTITY_PROVIDER,
} from './application/ports/staff-identity-provider';
import { SessionAuthenticator } from './application/access/session-authenticator';
import { IDENTITY_STORE } from './application/ports/identity-store';
import { SignInFlows } from './application/sign-in-flow';
import {
  BeginStaffSignIn,
  CompleteStaffSignIn,
  EndIdpSession,
  SESSION_HOURS,
  SIGN_IN_FLOWS,
} from './application/use-cases/sign-in.use-cases';
import {
  DisableLocalStaffAccount,
  RevokeRoleGrant,
  SyncStaffAccountsWithIdp,
} from './application/use-cases/staff-admin.use-cases';
import { STAFF_ACCESS_FACADE } from './contracts/staff-access.facade';
import {
  IDENTITY_CONFIG,
  identityConfigFromEnv,
  type IdentityConfig,
} from './infrastructure/identity-config';
import { IdentityRepository } from './infrastructure/identity.repository';
import { KeycloakAdmin } from './infrastructure/keycloak-admin';
import { KeycloakOidc } from './infrastructure/keycloak-oidc';
import { BackchannelController } from './presentation/backchannel.controller';
import { StaffAuthController } from './presentation/staff-auth.controller';
import { StudioAdminController } from './presentation/studio-admin.controller';

@Global()
@Module({
  controllers: [StaffAuthController, BackchannelController, StudioAdminController],
  providers: [
    { provide: IDENTITY_CONFIG, useFactory: () => identityConfigFromEnv() },
    {
      provide: SIGN_IN_FLOWS,
      inject: [IDENTITY_CONFIG],
      useFactory: (c: IdentityConfig) => new SignInFlows(c.flowKey),
    },
    {
      provide: SESSION_HOURS,
      inject: [IDENTITY_CONFIG],
      useFactory: (c: IdentityConfig) => c.sessionHours,
    },
    { provide: STAFF_IDENTITY_PROVIDER, useClass: KeycloakOidc },
    { provide: STAFF_DIRECTORY_ADMIN, useClass: KeycloakAdmin },
    { provide: IDENTITY_STORE, useClass: IdentityRepository },
    IdentityAuthorisationCheck,
    { provide: AUTHORISATION_CHECK, useExisting: IdentityAuthorisationCheck },
    { provide: STAFF_ACCESS_FACADE, useExisting: IdentityAuthorisationCheck },
    { provide: AUTHENTICATOR, useClass: SessionAuthenticator },
    BeginStaffSignIn,
    CompleteStaffSignIn,
    EndIdpSession,
    RevokeRoleGrant,
    DisableLocalStaffAccount,
    SyncStaffAccountsWithIdp,
  ],
  exports: [AUTHORISATION_CHECK, AUTHENTICATOR, STAFF_ACCESS_FACADE, SyncStaffAccountsWithIdp],
})
export class IdentityModule {}
