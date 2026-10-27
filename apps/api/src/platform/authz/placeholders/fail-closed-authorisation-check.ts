// Phoenix ADR-0010 decisions 2 and 6: the fail-closed placeholder of identity's authorisation
// check, bound by AuthzModule until the identity module (Phase 1, after PoC 2) binds its own.
// Authorisation is never stubbed permissively: this binding refuses every authenticated actor.
import { Injectable } from '@nestjs/common';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { AccessDecision, AuthorisationCheck } from '../authorisation-check';

const UNAVAILABLE: AccessDecision = Object.freeze({
  allowed: false,
  denial: Object.freeze({ code: 'access.unavailable' }),
});

/**
 * Always `access.unavailable`. No authenticated actor exists before identity anyway (the actor
 * guard refuses every credential), so this is the answer a misrouted call would get. Constant:
 * it reads no configuration and no environment.
 */
@FailClosedPlaceholder('identity.authorisationCheck')
@Injectable()
export class FailClosedAuthorisationCheck implements AuthorisationCheck {
  check(): Promise<AccessDecision> {
    return Promise.resolve(UNAVAILABLE);
  }
}
