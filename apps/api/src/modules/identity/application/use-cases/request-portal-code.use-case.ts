import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result, Temporal } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { CaptchaRejected, CaptchaService } from '../../../../platform/captcha';
import type { MailSender } from '../../../../platform/mail';
import {
  addressNetwork,
  type RateLimited,
  type RateLimiter,
} from '../../../../platform/rate-limit';
import type { SmsSender } from '../../../../platform/sms';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { TenantRegistry } from '../../../../platform/tenant-config/tenant-registry';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import {
  CODE_TTL_SECONDS,
  parseAddress,
  type InvalidPortalValue,
  type PortalMethod,
  type PortalSignInSettings,
} from '../../domain/portal';
import type { PortalCodes } from '../portal/portal-codes';
import {
  METHOD_UNAVAILABLE,
  PORTAL_UNAVAILABLE,
  type DeliveryFailed,
  type MethodUnavailable,
  type PortalUnavailable,
} from '../portal/portal-failures';
import {
  CODES_PER_ADDRESS,
  CODES_PER_CLIENT,
  CODES_PER_TENANT,
  PORTAL_ADDRESS_INDEX,
  PORTAL_CODE_CAPTCHA_PURPOSE,
} from '../portal/portal-limits';
import { codeMessage } from '../portal/portal-messages';
import type { PortalRepository } from '../portal/portal.repository';

export interface RequestPortalCodeInput {
  readonly method: PortalMethod;
  readonly address: string;
  /** The solved proof-of-work challenge (ALTCHA payload). */
  readonly captcha: string | undefined;
  readonly clientAddress: string;
}

export interface SentPortalCode {
  /** The browser sends it back with the code. */
  readonly challengeId: Id<'PortalCode'>;
  readonly expiresAt: Temporal.Instant;
}

export type RequestPortalCodeFailure =
  | InvalidPortalValue
  | MethodUnavailable
  | CaptchaRejected
  | RateLimited
  | DeliveryFailed
  | PortalUnavailable;

/**
 * Sends a one-time sign-in code to an email address or mobile number (ADR-0026 decisions 1 to
 * 3). The answer is the same whether or not an account has the address, so it reveals none.
 * In order: the tenant's settings (read-only unit), the address, the CAPTCHA (spent), the rate
 * limits (per address, client network and tenant), the code row (one unit), then delivery
 * outside any unit. `anonymous`: the visitor has no session.
 */
export class RequestPortalCode extends UseCase<
  RequestPortalCodeInput,
  SentPortalCode,
  RequestPortalCodeFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.request-portal-code',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly codes: PortalCodes,
    private readonly captcha: CaptchaService,
    private readonly limiter: RateLimiter,
    private readonly subjectKeys: SubjectKeyService,
    private readonly mail: MailSender,
    private readonly sms: SmsSender,
    private readonly tenants: TenantRegistry,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: RequestPortalCodeInput,
  ): Promise<Result<SentPortalCode, RequestPortalCodeFailure>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run<PortalSignInSettings, never>(
      tenant,
      async () => ok(await this.portal.settings(tenant)),
      { readOnly: true },
    );
    if (!read.ok) return read;
    const settings = read.value;
    const deliverable = input.method === 'email' ? this.mail.available : this.sms.available(tenant);
    if (!settings.methods.includes(input.method) || !deliverable) return err(METHOD_UNAVAILABLE);
    if (!this.subjectKeys.available) return err(PORTAL_UNAVAILABLE);
    const address = parseAddress(input.method, input.address, settings.countryCallingCode);
    if (!address.ok) return address;

    const solved = await this.captcha.verify(tenant, PORTAL_CODE_CAPTCHA_PURPOSE, input.captcha);
    if (!solved.ok) return solved;
    const lookupHash = this.subjectKeys.blindIndex(
      tenant,
      PORTAL_ADDRESS_INDEX,
      `${input.method}:${address.value}`,
    );
    for (const [rule, subject] of [
      [CODES_PER_ADDRESS, `address:${lookupHash.toString('hex')}`],
      [CODES_PER_CLIENT, `client:${addressNetwork(input.clientAddress)}`],
      [CODES_PER_TENANT, `tenant:${input.method}`],
    ] as const) {
      const limited = await this.limiter.consume(tenant, rule, subject);
      if (!limited.ok) return limited;
    }

    const id = this.ids.next<'PortalCode'>();
    const code = this.codes.issue();
    const codeHash = this.codes.hash(tenant, id, code)!;
    const now = this.clock.now();
    const expiresAt = now.add({ seconds: CODE_TTL_SECONDS });
    const stored = await this.unitOfWork.run<void, never>(tenant, async () => {
      await this.portal.insertCode(
        tenant,
        { id, kind: input.method, lookupHash, codeHash, expiresAt },
        now,
      );
      return ok(undefined);
    });
    if (!stored.ok) return stored;

    const presentation = this.tenants.get(tenant.tenantId);
    const message = codeMessage(presentation.defaultLocale, presentation.displayName, code);
    const sent =
      input.method === 'email'
        ? await this.mail.send(tenant, { to: address.value, ...message })
        : await this.sms.send(tenant, { to: address.value, text: message.text });
    if (!sent.ok) return err({ code: 'portal.delivery-failed' });
    return ok({ challengeId: id, expiresAt });
  }
}
