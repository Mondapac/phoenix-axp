// Phoenix ADR-0010 decisions 2 and 6: the fail-closed placeholder of identity's authenticator,
// bound by AuthzModule until the identity module binds its own. It rejects every credential.
import { Injectable } from '@nestjs/common';
import { err, type Result } from '@phoenix/shared-kernel';
import type { AuthenticatedActor } from '@phoenix/shared-kernel';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { Authenticator, CredentialRejected } from '../authenticator';

const REJECTED: CredentialRejected = Object.freeze({ code: 'credential.rejected' });

/** Always `credential.rejected`. Constant: it reads no configuration and no environment. */
@FailClosedPlaceholder('identity.authenticator')
@Injectable()
export class FailClosedAuthenticator implements Authenticator {
  authenticate(): Promise<Result<AuthenticatedActor, CredentialRejected>> {
    return Promise.resolve(err(REJECTED));
  }
}
