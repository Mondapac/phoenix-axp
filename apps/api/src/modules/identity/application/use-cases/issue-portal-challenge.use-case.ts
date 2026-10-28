import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { CaptchaService, ProofOfWorkChallenge } from '../../../../platform/captcha';
import {
  addressNetwork,
  type RateLimited,
  type RateLimiter,
} from '../../../../platform/rate-limit';
import { PORTAL_CHALLENGE_LIMIT, PORTAL_CODE_CAPTCHA_PURPOSE } from '../portal/portal-limits';

/**
 * A proof-of-work challenge for asking a sign-in code (ADR-0026 decision 3). Rate limited per
 * client network; nothing is stored until the answer is spent.
 */
export class IssuePortalChallenge extends UseCase<
  { readonly clientAddress: string },
  ProofOfWorkChallenge,
  RateLimited
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.issue-portal-challenge',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly captcha: CaptchaService,
    private readonly limiter: RateLimiter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: { readonly clientAddress: string },
  ): Promise<Result<ProofOfWorkChallenge, RateLimited>> {
    const limited = await this.limiter.consume(
      context.tenant,
      PORTAL_CHALLENGE_LIMIT,
      addressNetwork(input.clientAddress),
    );
    if (!limited.ok) return limited;
    return ok(this.captcha.issue(context.tenant, PORTAL_CODE_CAPTCHA_PURPOSE));
  }
}
