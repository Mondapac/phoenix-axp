// SPIKE (PoC 2): staff sign-in by OIDC Authorization Code + PKCE (ADR-0004 decision 1), then an
// opaque core session (decision 2). Both use cases are `anonymous`: the visitor has no session
// yet. One file for the spike; Phase 1 splits them one per file.
import { Inject } from '@nestjs/common';
import {
  err,
  ok,
  type CallContext,
  type Clock,
  type IdGenerator,
  type Result,
  type Temporal,
} from '@phoenix/shared-kernel';
import {
  UseCase,
  USE_CASE_GATE,
  type AccessDeclaration,
  type UseCaseGate,
} from '../../../../platform/authz';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { ID_GENERATOR } from '../../../../platform/ids/ids.module';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_STORE, type IdentityStore } from '../ports/identity-store';
import {
  STAFF_DIRECTORY_ADMIN,
  STAFF_IDENTITY_PROVIDER,
  type StaffDirectoryAdmin,
  type StaffIdentityProvider,
} from '../ports/staff-identity-provider';
import { newSessionToken, sessionTokenHash } from '../session-token';
import type { SignInFlows } from '../sign-in-flow';

export const SIGN_IN_FLOWS = Symbol('SIGN_IN_FLOWS');
export const SESSION_HOURS = Symbol('SESSION_HOURS');

export class BeginStaffSignIn extends UseCase<
  void,
  { authorizationUrl: string; flowSecret: string }
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.begin-staff-sign-in',
    rule: { kind: 'anonymous' },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(SIGN_IN_FLOWS) private readonly flows: SignInFlows,
    @Inject(STAFF_IDENTITY_PROVIDER) private readonly idp: StaffIdentityProvider,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
  ): Promise<Result<{ authorizationUrl: string; flowSecret: string }, never>> {
    const flowSecret = this.flows.issue();
    const flow = this.flows.derive(flowSecret, context.tenant)!;
    return Promise.resolve(
      ok({ authorizationUrl: this.idp.authorizationUrl(context.tenant, flow), flowSecret }),
    );
  }
}

export interface CompleteSignInInput {
  readonly code: string;
  readonly state: string;
  readonly flowSecret: string;
}

export type SignInFailure =
  | 'sign-in.flow-invalid'
  | 'sign-in.rejected'
  | 'sign-in.unavailable'
  | 'sign-in.no-staff-account'
  | 'sign-in.account-disabled';

export class CompleteStaffSignIn extends UseCase<
  CompleteSignInInput,
  { sessionToken: string; expiresAt: Temporal.Instant; accountId: string },
  SignInFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.complete-staff-sign-in',
    rule: { kind: 'anonymous' },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(SIGN_IN_FLOWS) private readonly flows: SignInFlows,
    @Inject(STAFF_IDENTITY_PROVIDER) private readonly idp: StaffIdentityProvider,
    @Inject(STAFF_DIRECTORY_ADMIN) private readonly directory: StaffDirectoryAdmin,
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(SESSION_HOURS) private readonly sessionHours: number,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CompleteSignInInput,
  ): Promise<
    Result<{ sessionToken: string; expiresAt: Temporal.Instant; accountId: string }, SignInFailure>
  > {
    const { tenant } = context;
    const flow = this.flows.derive(input.flowSecret, tenant);
    if (flow === null || !this.flows.stateMatches(flow, input.state))
      return err('sign-in.flow-invalid');
    // HTTP to the IdP, outside any unit.
    const identity = await this.idp.exchange(tenant, input.code, flow);
    if (!identity.ok)
      return err(
        identity.error === 'provider.unavailable' ? 'sign-in.unavailable' : 'sign-in.rejected',
      );

    const known = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.accounts.accountBySubject(tenant, identity.value.subject)),
      { readOnly: true },
    );
    let account = known.ok ? known.value : null;
    if (account === null) {
      // A directory employee gets an account (no roles) on first sign-in; a local account is
      // created only through studio (ADR-0019 decision 3), so an unknown local user is refused.
      const idpAccount = await this.directory.account(tenant, identity.value.subject);
      if (!idpAccount.ok) return err('sign-in.unavailable');
      if (!idpAccount.value.exists || !idpAccount.value.directory)
        return err('sign-in.no-staff-account');
      const id = this.ids.next<'Account'>();
      const createdAt = this.clock.now();
      await this.unitOfWork.run(tenant, async () => {
        await this.accounts.createAccount(tenant, {
          id,
          subject: identity.value.subject,
          username: identity.value.username,
          source: 'directory',
          createdAt,
        });
        return ok(undefined);
      });
      account = {
        id,
        subject: identity.value.subject,
        username: identity.value.username,
        source: 'directory',
        status: 'active',
      };
    }
    if (account.status !== 'active') return err('sign-in.account-disabled');

    const sessionToken = newSessionToken();
    const tokenHash = sessionTokenHash(sessionToken);
    const now = this.clock.now();
    const expiresAt = now.add({ hours: this.sessionHours });
    const accountId = account.id;
    await this.unitOfWork.run(tenant, async () => {
      await this.accounts.createSession(tenant, {
        id: this.ids.next<'Session'>(),
        accountId,
        tokenHash,
        idpSessionId: identity.value.idpSessionId,
        createdAt: now,
        expiresAt,
      });
      return ok(undefined);
    });
    return ok({ sessionToken, expiresAt, accountId });
  }
}

/**
 * OIDC back-channel logout: the IdP ended a user's SSO session (sign-out, admin logout, account
 * disabled in Keycloak); the core ends its sessions of that IdP session. `anonymous`: the
 * caller is the IdP, authenticated by the logout token's signature.
 */
export class EndIdpSession extends UseCase<
  { logoutToken: string },
  { sessionsEnded: number },
  'logout.rejected'
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.end-idp-session',
    rule: { kind: 'anonymous' },
  };

  constructor(
    @Inject(USE_CASE_GATE) gate: UseCaseGate,
    @Inject(STAFF_IDENTITY_PROVIDER) private readonly idp: StaffIdentityProvider,
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { logoutToken: string },
  ): Promise<Result<{ sessionsEnded: number }, 'logout.rejected'>> {
    const { tenant } = context;
    const notice = await this.idp.verifyLogoutToken(tenant, input.logoutToken);
    if (!notice.ok) return err('logout.rejected');
    const { idpSessionId, subject } = notice.value;
    const ended = await this.unitOfWork.run(tenant, async () => {
      if (idpSessionId !== null)
        return ok(await this.accounts.endSessionsByIdpSession(tenant, idpSessionId));
      const account = await this.accounts.accountBySubject(tenant, subject!);
      return ok(
        account === null ? 0 : await this.accounts.endSessionsOfAccount(tenant, account.id),
      );
    });
    return ok({ sessionsEnded: ended.ok ? ended.value : 0 });
  }
}
