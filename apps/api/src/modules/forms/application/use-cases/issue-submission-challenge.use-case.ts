import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { CaptchaService, ProofOfWorkChallenge } from '../../../../platform/captcha';
import type { RateLimited, RateLimiter } from '../../../../platform/rate-limit';
import { CHALLENGE_LIMIT, limitSubject, SUBMIT_CAPTCHA_PURPOSE } from '../rate-limits';

/**
 * A proof-of-work challenge for submitting a form without signing in (the self-hosted
 * CAPTCHA of the phase 2 review). Rate limited per client. The use case has no unit of work:
 * nothing is stored until the answer is spent.
 */
export class IssueSubmissionChallenge extends UseCase<
  { readonly clientAddress: string },
  ProofOfWorkChallenge,
  RateLimited
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.issue-submission-challenge',
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
    const { tenant, actor } = context;
    const limited = await this.limiter.consume(
      tenant,
      CHALLENGE_LIMIT,
      limitSubject(actor, input.clientAddress),
    );
    if (!limited.ok) return limited;
    return ok(this.captcha.issue(tenant, SUBMIT_CAPTCHA_PURPOSE));
  }
}
