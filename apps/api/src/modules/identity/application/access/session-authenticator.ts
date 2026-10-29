// The Authenticator identity binds for the ActorGuard (ADR-0004 decision 2), from the PoC 2
// spike: every request reads the session and its account's status in one read-only unit, and
// nothing is cached, so an ended session or a disabled account is refused on the very next
// request. The one file that mints authenticated actors (dependency-cruiser rule
// `authenticated-actor-is-built-by-the-authenticator`).
import { err, ok } from '@phoenix/shared-kernel';
import type {
  AuthenticatedActor,
  Clock,
  Population,
  Result,
  TenantContext,
} from '@phoenix/shared-kernel';
import { authenticatedActor } from '@phoenix/shared-kernel/authenticated-actor';
import type { Authenticator, CredentialRejected } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { SessionRepository } from '../session.repository';
import { SESSION_TOKEN_PATTERN, sessionTokenHash } from '../session-token';

const REJECTED: CredentialRejected = Object.freeze({ code: 'credential.rejected' });

export class SessionAuthenticator implements Authenticator {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * The session is looked up in the request's tenant only: under row-level security a session
   * of another tenant does not exist, so a cookie sent with another tenant's header is
   * rejected (security review S2-3). A session of another population than the cookie's is
   * rejected too (ADR-0026 decision 5).
   */
  async authenticate(
    tenant: TenantContext,
    token: string,
    expected: Population = 'tenant-staff',
  ): Promise<Result<AuthenticatedActor, CredentialRejected>> {
    if (!SESSION_TOKEN_PATTERN.test(token)) return err(REJECTED);
    const hash = sessionTokenHash(token); // outside the unit: no hashing inside a unit
    const now = this.clock.now();
    const found = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.sessions.findLive(tenant, hash, now)),
      { readOnly: true },
    );
    if (
      !found.ok ||
      found.value === null ||
      found.value.accountStatus !== 'active' ||
      found.value.population !== expected
    ) {
      return err(REJECTED);
    }
    const { population, accountId, sessionId } = found.value;
    return ok(authenticatedActor(tenant, { population, accountId, sessionId }));
  }
}
