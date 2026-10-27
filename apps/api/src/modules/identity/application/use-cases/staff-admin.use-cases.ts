// SPIKE (PoC 2): the studio actions the criteria need, and the IdP sync job. One file for the
// spike; Phase 1 splits them one per file, adds audit (ADR-0015) and GrantPolicy.
import { Inject } from '@nestjs/common';
import { err, ok, type CallContext, type Clock, type Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  USE_CASE_GATE,
  type AccessDeclaration,
  type UseCaseGate,
} from '../../../../platform/authz';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import {
  IDENTITY_ROLE_GRANT_REVOKE,
  IDENTITY_STAFF_ACCOUNT_DISABLE,
} from '../../contracts/permissions';
import { IDENTITY_STORE, type IdentityStore } from '../ports/identity-store';
import { STAFF_DIRECTORY_ADMIN, type StaffDirectoryAdmin } from '../ports/staff-identity-provider';

export class RevokeRoleGrant extends UseCase<
  { grantId: string },
  { revoked: true },
  'grant.not-found'
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.revoke-role-grant',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLE_GRANT_REVOKE] },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { grantId: string },
  ): Promise<Result<{ revoked: true }, 'grant.not-found'>> {
    const { tenant } = context;
    return this.unitOfWork.run(tenant, async () =>
      (await this.accounts.deleteGrant(tenant, input.grantId))
        ? ok({ revoked: true as const })
        : err('grant.not-found' as const),
    );
  }
}

export type DisableFailure = 'account.not-found' | 'account.not-local';

/**
 * Disables a local staff account (ADR-0019 decision 3): in the core first, in one unit
 * (account disabled, every core session ended), so the next request is refused whatever the
 * IdP does; then in Keycloak (disable + end its SSO sessions), outside the unit.
 */
export class DisableLocalStaffAccount extends UseCase<
  { accountId: string },
  { sessionsEnded: number; idpDisabled: boolean },
  DisableFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.disable-local-staff-account',
    rule: { kind: 'permissions', allOf: [IDENTITY_STAFF_ACCOUNT_DISABLE] },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(STAFF_DIRECTORY_ADMIN) private readonly directory: StaffDirectoryAdmin,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { accountId: string },
  ): Promise<Result<{ sessionsEnded: number; idpDisabled: boolean }, DisableFailure>> {
    const { tenant } = context;
    const at = this.clock.now();
    const done = await this.unitOfWork.run(tenant, async () => {
      const account = await this.accounts.accountById(tenant, input.accountId);
      if (account === null) return err('account.not-found' as const);
      if (account.source !== 'local') return err('account.not-local' as const);
      const { sessionsEnded } = await this.accounts.disableAccount(tenant, account.id, at);
      return ok({ subject: account.subject, sessionsEnded });
    });
    if (!done.ok) return done;
    // After commit; a failure here leaves the core disabled (Phase 1: outbox + retry).
    const idp = await this.directory.disableLocal(tenant, done.value.subject);
    return ok({ sessionsEnded: done.value.sessionsEnded, idpDisabled: idp.ok });
  }
}

export interface SyncReport {
  readonly checked: number;
  readonly disabled: number;
  readonly unavailable: number;
}

/**
 * The sync path of ADR-0004 decision 3, a worker job (`system`): every active staff account of
 * the tenant is looked up in Keycloak, which reads the directory for federated users (cache
 * policy NO_CACHE). An account Keycloak no longer finds or reports disabled (left the
 * directory, disabled in AD, disabled in the Keycloak console) is disabled in the core and its
 * sessions end. An unreachable IdP changes nothing (no mass disable on an outage).
 */
export class SyncStaffAccountsWithIdp extends UseCase<void, SyncReport> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.sync-staff-accounts-with-idp',
    rule: { kind: 'system' },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(STAFF_DIRECTORY_ADMIN) private readonly directory: StaffDirectoryAdmin,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<SyncReport, never>> {
    const { tenant } = context;
    const active = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.accounts.activeAccounts(tenant)),
      { readOnly: true },
    );
    let disabled = 0;
    let unavailable = 0;
    const accounts = active.ok ? active.value : [];
    for (const account of accounts) {
      const state = await this.directory.account(tenant, account.subject);
      if (!state.ok) {
        unavailable += 1;
        continue;
      }
      if (state.value.exists && state.value.enabled) continue;
      const at = this.clock.now();
      await this.unitOfWork.run(tenant, async () => {
        await this.accounts.disableAccount(tenant, account.id, at);
        return ok(undefined);
      });
      disabled += 1;
    }
    return ok({ checked: accounts.length, disabled, unavailable });
  }
}
