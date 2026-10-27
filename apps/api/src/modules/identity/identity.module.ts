import { Module, type Provider } from '@nestjs/common';
import type { Clock } from '@phoenix/shared-kernel';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER } from '../../platform/audit/audit-writer';
import {
  AUTHENTICATOR,
  AUTHORISATION_CHECK,
  PermissionRegistry,
  registerPermissions,
  USE_CASE_GATE,
} from '../../platform/authz';
import { CLOCK } from '../../platform/clock/clock.module';
import type { AppConfig } from '../../platform/config/app-config';
import { APP_CONFIG } from '../../platform/config/config.module';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/unit-of-work/unit-of-work';
import { ACCOUNT_REPOSITORY } from './application/account.repository';
import { IdentityAuthorisationCheck } from './application/access/identity-authorisation-check';
import { SessionAuthenticator } from './application/access/session-authenticator';
import { SESSION_REPOSITORY, type SessionRepository } from './application/session.repository';
import { SIGN_IN_FLOWS, SignInFlows } from './application/sign-in-flow';
import {
  STAFF_IDENTITY_PROVIDER,
  STAFF_SESSION_HOURS,
} from './application/staff-identity-provider';
import { BeginStaffSignIn } from './application/use-cases/begin-staff-sign-in.use-case';
import { CompleteStaffSignIn } from './application/use-cases/complete-staff-sign-in.use-case';
import { CreateLocalStaffAccount } from './application/use-cases/create-local-staff-account.use-case';
import { DisableStaffAccount } from './application/use-cases/disable-staff-account.use-case';
import { ListStaffAccounts } from './application/use-cases/list-staff-accounts.use-case';
import { SignOut } from './application/use-cases/sign-out.use-case';
import { ViewOwnAccount } from './application/use-cases/view-own-account.use-case';
import { IDENTITY_PERMISSIONS } from './contracts/permissions';
import { IDENTITY_AUDIT_ACTIONS } from './domain/audit-actions';
import { KeycloakOidc, UnconfiguredIdentityProvider } from './infrastructure/keycloak-oidc';
import { PrismaAccountRepository } from './infrastructure/prisma-account.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { StaffAccountsController } from './presentation/staff-accounts.controller';
import { StaffSignInController } from './presentation/staff-sign-in.controller';

const SESSIONS = { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository };

/**
 * The identity module's answers to platform/authz: the `AUTHENTICATOR` of the ActorGuard and the
 * `AUTHORISATION_CHECK` of the UseCaseGate. Passed to `AuthzModule.register` by app.module.ts,
 * so platform/ imports no module; it needs only the global persistence, clock and permission
 * registry providers.
 */
@Module({
  providers: [
    SESSIONS,
    {
      provide: AUTHENTICATOR,
      inject: [UNIT_OF_WORK, SESSION_REPOSITORY, CLOCK],
      useFactory: (unitOfWork: UnitOfWork, sessions: SessionRepository, clock: Clock) =>
        new SessionAuthenticator(unitOfWork, sessions, clock),
    },
    {
      provide: AUTHORISATION_CHECK,
      inject: [UNIT_OF_WORK, SESSION_REPOSITORY, PermissionRegistry, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        sessions: SessionRepository,
        permissions: PermissionRegistry,
        clock: Clock,
      ) => new IdentityAuthorisationCheck(unitOfWork, sessions, permissions, clock),
    },
  ],
  exports: [AUTHENTICATOR, AUTHORISATION_CHECK],
})
export class IdentityAccessModule {}

/** Each use case built with the gate first and its ports after, in constructor order. */
function useCase(type: abstract new (...args: never[]) => unknown, inject: unknown[]): Provider {
  return {
    provide: type,
    inject: [USE_CASE_GATE, ...inject] as never[],
    useFactory: (...deps: unknown[]) =>
      new (type as unknown as new (...args: unknown[]) => unknown)(...deps),
  };
}

const ACCOUNTS = ACCOUNT_REPOSITORY;

/**
 * The identity module (Phase 1 slice 1.5): staff sign-in through the tenant's Keycloak realm,
 * opaque sessions, and local staff accounts, behind the studio API. Its audit writer stays
 * inside the module.
 */
@Module({
  controllers: [StaffSignInController, StaffAccountsController],
  providers: [
    registerPermissions('identity', IDENTITY_PERMISSIONS),
    registerAuditActions('identity', IDENTITY_AUDIT_ACTIONS),
    PersistenceModule.auditWriterFor('identity'),
    SESSIONS,
    { provide: ACCOUNTS, useClass: PrismaAccountRepository },
    {
      provide: SIGN_IN_FLOWS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SignInFlows(config.session.secret),
    },
    {
      provide: STAFF_IDENTITY_PROVIDER,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) =>
        config.keycloak === null
          ? new UnconfiguredIdentityProvider()
          : new KeycloakOidc(config.keycloak, clock),
    },
    {
      provide: STAFF_SESSION_HOURS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => config.session.staffSessionHours,
    },
    useCase(BeginStaffSignIn, [SIGN_IN_FLOWS, STAFF_IDENTITY_PROVIDER]),
    useCase(CompleteStaffSignIn, [
      UNIT_OF_WORK,
      SIGN_IN_FLOWS,
      STAFF_IDENTITY_PROVIDER,
      ACCOUNTS,
      SESSION_REPOSITORY,
      AUDIT_WRITER,
      CLOCK,
      ID_GENERATOR,
      STAFF_SESSION_HOURS,
    ]),
    useCase(SignOut, [UNIT_OF_WORK, SESSION_REPOSITORY, AUDIT_WRITER]),
    useCase(ViewOwnAccount, [UNIT_OF_WORK, ACCOUNTS]),
    useCase(ListStaffAccounts, [UNIT_OF_WORK, ACCOUNTS]),
    useCase(CreateLocalStaffAccount, [UNIT_OF_WORK, ACCOUNTS, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(DisableStaffAccount, [UNIT_OF_WORK, ACCOUNTS, SESSION_REPOSITORY, AUDIT_WRITER, CLOCK]),
  ],
})
export class IdentityModule {}
