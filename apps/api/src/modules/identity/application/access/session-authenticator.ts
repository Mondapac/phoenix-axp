// SPIKE (PoC 2): the Authenticator identity binds for the ActorGuard. Every request reads the
// session and the account's status from PostgreSQL (one read-only unit); nothing is cached, so
// a disabled account or an ended session is refused on the very next request.
import { Inject, Injectable } from '@nestjs/common';
import {
  err,
  ok,
  parseId,
  type Clock,
  type Result,
  type TenantContext,
} from '@phoenix/shared-kernel';
import type { AuthenticatedActor } from '@phoenix/shared-kernel';
import { authenticatedActor } from '@phoenix/shared-kernel/authenticated-actor';
import type { Authenticator, CredentialRejected } from '../../../../platform/authz';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_STORE, type IdentityStore } from '../ports/identity-store';
import { SESSION_TOKEN_PATTERN, sessionTokenHash } from '../session-token';

const REJECTED: CredentialRejected = Object.freeze({ code: 'credential.rejected' });

@Injectable()
export class SessionAuthenticator implements Authenticator {
  constructor(
    @Inject(IDENTITY_STORE) private readonly accounts: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async authenticate(
    tenant: TenantContext,
    token: string,
  ): Promise<Result<AuthenticatedActor, CredentialRejected>> {
    if (!SESSION_TOKEN_PATTERN.test(token)) return err(REJECTED);
    const hash = sessionTokenHash(token); // outside the unit: no hashing inside a unit
    const now = this.clock.now();
    const found = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.accounts.liveSession(tenant, hash, now)),
      { readOnly: true },
    );
    if (!found.ok || found.value === null || found.value.accountStatus !== 'active')
      return err(REJECTED);
    const accountId = parseId<'Account'>(found.value.accountId);
    const sessionId = parseId<'Session'>(found.value.id);
    if (!accountId.ok || !sessionId.ok) return err(REJECTED);
    return ok(
      authenticatedActor(tenant, {
        population: 'tenant-staff',
        accountId: accountId.value,
        sessionId: sessionId.value,
      }),
    );
  }
}
