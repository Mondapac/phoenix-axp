import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import {
  addressNetwork,
  type RateLimited,
  type RateLimiter,
} from '../../../../platform/rate-limit';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { ACCOUNT_PROVISIONED, SESSION_STARTED } from '../../domain/audit-actions';
import {
  MAX_CODE_FAILURES,
  PORTAL_ACCOUNT_SOURCE,
  parseAddress,
  type InvalidPortalValue,
  type PortalMethod,
  type PortalSignInSettings,
} from '../../domain/portal';
import { PortalCodes } from '../portal/portal-codes';
import {
  CODE_INVALID,
  METHOD_UNAVAILABLE,
  PORTAL_UNAVAILABLE,
  type CodeInvalid,
  type MethodUnavailable,
  type PortalAccountDisabled,
  type PortalUnavailable,
} from '../portal/portal-failures';
import { ANSWERS_PER_CLIENT, PORTAL_ADDRESS_INDEX } from '../portal/portal-limits';
import type { PortalRepository } from '../portal/portal.repository';
import type { SessionRepository } from '../session.repository';
import { newSessionToken, sessionTokenHash } from '../session-token';
import type { StartedSession } from './complete-staff-sign-in.use-case';

export interface VerifyPortalCodeInput {
  readonly challengeId: Id<'PortalCode'>;
  readonly method: PortalMethod;
  readonly address: string;
  readonly code: string;
  /** The client's address, for the rate limit only; never stored. */
  readonly clientAddress: string;
}

export type VerifyPortalCodeFailure =
  | InvalidPortalValue
  | MethodUnavailable
  | RateLimited
  | CodeInvalid
  | PortalAccountDisabled
  | PortalUnavailable;

type Checked =
  | { readonly kind: 'wrong' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'signed-in'; readonly session: StartedSession };

/**
 * Checks a one-time code and signs the portal user in (ADR-0026 decisions 1, 3 to 5): the
 * first right code for an address creates its portal account, with the address sealed under
 * the account's own subject key; every right code starts a session. A wrong answer counts
 * against the code (spent at {@link MAX_CODE_FAILURES}); every answer counts, through a rate
 * limit, against the client's network. Every wrong, expired, spent or foreign code answers
 * the same.
 * `anonymous`: the visitor has no session yet.
 */
export class VerifyPortalCode extends UseCase<
  VerifyPortalCodeInput,
  StartedSession,
  VerifyPortalCodeFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.verify-portal-code',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly codes: PortalCodes,
    private readonly limiter: RateLimiter,
    private readonly subjectKeys: SubjectKeyService,
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
    input: VerifyPortalCodeInput,
  ): Promise<Result<StartedSession, VerifyPortalCodeFailure>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run<PortalSignInSettings, never>(
      tenant,
      async () => ok(await this.portal.settings(tenant)),
      { readOnly: true },
    );
    if (!read.ok) return read;
    if (!read.value.methods.includes(input.method)) return err(METHOD_UNAVAILABLE);
    if (!this.subjectKeys.available) return err(PORTAL_UNAVAILABLE);
    const address = parseAddress(input.method, input.address, read.value.countryCallingCode);
    if (!address.ok) return address;

    // The slow and keyed work before the unit: hashes, the seal of a possible new account,
    // the session token.
    const lookupHash = this.subjectKeys.blindIndex(
      tenant,
      PORTAL_ADDRESS_INDEX,
      `${input.method}:${address.value}`,
    );
    const limited = await this.limiter.consume(
      tenant,
      ANSWERS_PER_CLIENT,
      `client:${addressNetwork(input.clientAddress)}`,
    );
    if (!limited.ok) return limited;
    const candidate = this.codes.hash(tenant, input.challengeId, input.code);
    const newAccountId = this.ids.next<'Account'>();
    const sealed = this.subjectKeys.seal(tenant, newAccountId, Buffer.from(address.value, 'utf8'));
    const sessionToken = newSessionToken();
    const tokenHash = sessionTokenHash(sessionToken);
    const sessionId = this.ids.next<'Session'>();

    const checked = await this.unitOfWork.run<Checked, CodeInvalid>(tenant, async () => {
      const now = this.clock.now();
      const code = await this.portal.findCode(tenant, input.challengeId);
      if (
        code === null ||
        code.spent ||
        Temporal.Instant.compare(code.expiresAt, now) <= 0 ||
        code.kind !== input.method ||
        !PortalCodes.matches(code.lookupHash, lookupHash)
      ) {
        return err(CODE_INVALID);
      }
      if (!PortalCodes.matches(code.codeHash, candidate)) {
        await this.portal.recordFailure(tenant, code.id, MAX_CODE_FAILURES, now);
        return ok({ kind: 'wrong' });
      }
      // Conditional: of two right answers at once, one signs in.
      if (!(await this.portal.spendCode(tenant, code.id, now))) return err(CODE_INVALID);

      let accountId: Id<'Account'>;
      const existing = await this.portal.findByAddress(tenant, input.method, lookupHash);
      if (existing !== null) {
        // The code is spent either way: a disabled account's code is not reusable.
        if (existing.status !== 'active') return ok({ kind: 'disabled' });
        accountId = existing.accountId;
      } else {
        accountId = newAccountId;
        const created = await this.portal.insertAccount(
          tenant,
          { id: accountId, kind: input.method, lookupHash, sealed: sealed.ciphertext },
          now,
        );
        // A concurrent first sign-in of the same address won; its code was another one.
        if (created === 'taken') return err(CODE_INVALID);
        await this.subjectKeys.store(tenant, accountId, 'identity', sealed.wrappedKey, now);
        await this.audit.record(
          context,
          ACCOUNT_PROVISIONED.entry(accountId, {
            after: { boundSubjectId: accountId, source: PORTAL_ACCOUNT_SOURCE },
          }),
        );
      }
      const expiresAt = now.add({ hours: this.sessionHours });
      await this.sessions.insert(
        tenant,
        { id: sessionId, accountId, tokenHash, idpSessionId: null, expiresAt },
        now,
      );
      await this.audit.record(
        context,
        SESSION_STARTED.entry(sessionId, { after: { boundSubjectId: accountId } }),
      );
      return ok({ kind: 'signed-in', session: { sessionToken, expiresAt, accountId } });
    });
    if (!checked.ok) return checked;
    switch (checked.value.kind) {
      case 'wrong':
        return err(CODE_INVALID);
      case 'disabled':
        return err({ code: 'portal.account-disabled' });
      case 'signed-in':
        return ok(checked.value.session);
    }
  }
}
