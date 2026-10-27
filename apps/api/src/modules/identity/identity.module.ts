import { Module, type Provider } from '@nestjs/common';
import type { Clock } from '@phoenix/shared-kernel';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER, type AuditWriter } from '../../platform/audit/audit-writer';
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
import { registerJobsFrom } from '../../platform/scheduler/job-registry';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/unit-of-work/unit-of-work';
import { ACCOUNT_REPOSITORY, type AccountRepository } from './application/account.repository';
import { IdentityAuthorisationCheck } from './application/access/identity-authorisation-check';
import { SessionAuthenticator } from './application/access/session-authenticator';
import { DirectorySyncRunner } from './application/directory-sync-runner';
import {
  DIRECTORY_SYNC_REPOSITORY,
  type DirectorySyncRepository,
} from './application/directory-sync.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './application/session.repository';
import { SIGN_IN_FLOWS, SignInFlows } from './application/sign-in-flow';
import {
  STAFF_IDENTITY_PROVIDER,
  STAFF_SESSION_HOURS,
} from './application/staff-identity-provider';
import { STAFF_DIRECTORY, type StaffDirectory } from './application/staff-directory';
import { BeginStaffSignIn } from './application/use-cases/begin-staff-sign-in.use-case';
import { CompleteStaffSignIn } from './application/use-cases/complete-staff-sign-in.use-case';
import { CreateLocalStaffAccount } from './application/use-cases/create-local-staff-account.use-case';
import { DisableStaffAccount } from './application/use-cases/disable-staff-account.use-case';
import { ListStaffAccounts } from './application/use-cases/list-staff-accounts.use-case';
import { RunDirectorySyncNow } from './application/use-cases/run-directory-sync-now.use-case';
import { SignOut } from './application/use-cases/sign-out.use-case';
import { SyncDirectoryAccounts } from './application/use-cases/sync-directory-accounts.use-case';
import { UpdateDirectorySyncInterval } from './application/use-cases/update-directory-sync-interval.use-case';
import { ViewDirectorySync } from './application/use-cases/view-directory-sync.use-case';
import { ViewOwnAccount } from './application/use-cases/view-own-account.use-case';
import { IDENTITY_PERMISSIONS } from './contracts/permissions';
import { IDENTITY_AUDIT_ACTIONS } from './domain/audit-actions';
import { KeycloakDirectory, UnconfiguredDirectory } from './infrastructure/keycloak-directory';
import { KeycloakOidc, UnconfiguredIdentityProvider } from './infrastructure/keycloak-oidc';
import { PrismaAccountRepository } from './infrastructure/prisma-account.repository';
import { PrismaDirectorySyncRepository } from './infrastructure/prisma-directory-sync.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { DirectorySyncController } from './presentation/directory-sync.controller';
import { syncDirectoryAccountsJob } from './presentation/jobs/sync-directory-accounts.job';
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
 * opaque sessions, local staff accounts, and the per-tenant directory sync with its "sync now",
 * behind the studio API. Its audit writer stays inside the module.
 */
@Module({
  controllers: [StaffSignInController, StaffAccountsController, DirectorySyncController],
  providers: [
    registerPermissions('identity', IDENTITY_PERMISSIONS),
    registerAuditActions('identity', IDENTITY_AUDIT_ACTIONS),
    PersistenceModule.auditWriterFor('identity'),
    SESSIONS,
    { provide: ACCOUNTS, useClass: PrismaAccountRepository },
    { provide: DIRECTORY_SYNC_REPOSITORY, useClass: PrismaDirectorySyncRepository },
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
      provide: STAFF_DIRECTORY,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) =>
        config.keycloak === null
          ? new UnconfiguredDirectory()
          : new KeycloakDirectory(config.keycloak, clock),
    },
    {
      provide: DirectorySyncRunner,
      inject: [
        UNIT_OF_WORK,
        DIRECTORY_SYNC_REPOSITORY,
        ACCOUNTS,
        SESSION_REPOSITORY,
        STAFF_DIRECTORY,
        AUDIT_WRITER,
        CLOCK,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        syncs: DirectorySyncRepository,
        accounts: AccountRepository,
        sessions: SessionRepository,
        directory: StaffDirectory,
        audit: AuditWriter,
        clock: Clock,
      ) => new DirectorySyncRunner(unitOfWork, syncs, accounts, sessions, directory, audit, clock),
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
    useCase(SyncDirectoryAccounts, [DirectorySyncRunner]),
    useCase(RunDirectorySyncNow, [DirectorySyncRunner]),
    useCase(ViewDirectorySync, [UNIT_OF_WORK, DIRECTORY_SYNC_REPOSITORY]),
    useCase(UpdateDirectorySyncInterval, [
      UNIT_OF_WORK,
      DIRECTORY_SYNC_REPOSITORY,
      AUDIT_WRITER,
      CLOCK,
    ]),
    registerJobsFrom('identity', [SyncDirectoryAccounts], (sync: SyncDirectoryAccounts) => [
      syncDirectoryAccountsJob(sync),
    ]),
  ],
})
export class IdentityModule {}
