import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result, Temporal } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { matchSignIn } from '../../domain/account';
import { ACCOUNT_LINKED, ACCOUNT_PROVISIONED, SESSION_STARTED } from '../../domain/audit-actions';
import type { AccountRepository } from '../account.repository';
import type { SignInFailure } from '../failures';
import type { SessionRepository } from '../session.repository';
import { newSessionToken, sessionTokenHash } from '../session-token';
import type { SignInFlows } from '../sign-in-flow';
import type { StaffIdentityProvider } from '../staff-identity-provider';

export interface CompleteStaffSignInInput {
  readonly code: string;
  readonly state: string;
  /** From the flow cookie; '' when the cookie is missing. */
  readonly flowSecret: string;
}

export interface StartedSession {
  /** The opaque token for the session cookie: returned once, never stored. */
  readonly sessionToken: string;
  readonly expiresAt: Temporal.Instant;
  readonly accountId: Id<'Account'>;
}

const failure = (code: SignInFailure['code']): Result<never, SignInFailure> => err({ code });

/**
 * Completes a staff sign-in (ADR-0004 decisions 1 and 2, ADR-0019 decision 3): checks the
 * flow, exchanges the code with the tenant's Keycloak realm (HTTP, outside any unit), then in
 * one unit finds or provisions the account and starts an opaque session. A directory user's
 * first sign-in creates an account with no roles; a local user must have an account created in
 * studio, which the first sign-in links to the subject. A disabled account never gets a
 * session. `anonymous`: the visitor has no session yet.
 */
export class CompleteStaffSignIn extends UseCase<
  CompleteStaffSignInInput,
  StartedSession,
  SignInFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.complete-staff-sign-in',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly flows: SignInFlows,
    private readonly provider: StaffIdentityProvider,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly sessionHours: number,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: CompleteStaffSignInInput,
  ): Promise<Result<StartedSession, SignInFailure>> {
    const { tenant } = context;
    const flow = this.flows.derive(input.flowSecret, tenant);
    if (flow === null || input.code === '' || !this.flows.stateMatches(flow, input.state)) {
      return failure('sign-in.flow-invalid');
    }
    const exchanged = await this.provider.exchange(tenant, input.code, flow);
    if (!exchanged.ok) {
      return failure(
        exchanged.error === 'provider.unavailable' ? 'sign-in.unavailable' : 'sign-in.rejected',
      );
    }
    const identity = exchanged.value;
    // Token and hash outside the unit: no hashing inside a unit.
    const sessionToken = newSessionToken();
    const tokenHash = sessionTokenHash(sessionToken);
    const sessionId = this.ids.next<'Session'>();
    const newAccountId = this.ids.next<'Account'>();

    return this.unitOfWork.run<StartedSession, SignInFailure>(tenant, async () => {
      const now = this.clock.now();
      const match = matchSignIn(
        identity,
        await this.accounts.findBySubject(tenant, identity.subject),
        await this.accounts.findByUsername(tenant, identity.username),
      );
      let accountId: Id<'Account'>;
      switch (match.kind) {
        case 'refused':
          return failure('sign-in.no-staff-account');
        case 'existing':
          if (match.account.status !== 'active') return failure('sign-in.account-disabled');
          accountId = match.account.id;
          break;
        case 'link-local':
          if (match.account.status !== 'active') return failure('sign-in.account-disabled');
          accountId = match.account.id;
          await this.accounts.link(tenant, accountId, match.account.version, identity.subject, now);
          await this.audit.record(
            context,
            ACCOUNT_LINKED.entry(accountId, { after: { boundSubjectId: accountId } }),
          );
          break;
        case 'create-directory': {
          accountId = newAccountId;
          const created = await this.accounts.insert(
            tenant,
            {
              id: accountId,
              source: 'directory',
              subject: identity.subject,
              username: identity.username,
            },
            now,
          );
          if (created === 'taken') return failure('sign-in.no-staff-account');
          await this.audit.record(
            context,
            ACCOUNT_PROVISIONED.entry(accountId, {
              after: { boundSubjectId: accountId, source: 'directory' },
            }),
          );
          break;
        }
      }
      const expiresAt = now.add({ hours: this.sessionHours });
      await this.sessions.insert(
        tenant,
        { id: sessionId, accountId, tokenHash, idpSessionId: identity.idpSessionId, expiresAt },
        now,
      );
      await this.audit.record(
        context,
        SESSION_STARTED.entry(sessionId, { after: { boundSubjectId: accountId } }),
      );
      return ok({ sessionToken, expiresAt, accountId });
    });
  }
}
