import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { MailSender } from '../../../../platform/mail';
import type { SmsSender } from '../../../../platform/sms';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { PortalMethod } from '../../domain/portal';
import type { PortalRepository } from '../portal/portal.repository';

export interface PortalSignInOptions {
  /** The methods the tenant offers and can deliver now; empty: sign-in is closed. */
  readonly methods: readonly PortalMethod[];
  /** Digits; the portal shows it before a national number. */
  readonly countryCallingCode: string | null;
}

/**
 * How a visitor may sign in to the tenant's portal (ADR-0026 decision 2): the methods the
 * tenant opened that a sender can deliver now. `anonymous`: the sign-in page shows it.
 */
export class ViewPortalSignInOptions extends UseCase<void, PortalSignInOptions, never> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-portal-sign-in-options',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly mail: MailSender,
    private readonly sms: SmsSender,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<PortalSignInOptions, never>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run<
      Awaited<ReturnType<PortalRepository['settings']>>,
      never
    >(tenant, async () => ok(await this.portal.settings(tenant)), { readOnly: true });
    if (!read.ok) return read;
    const deliverable = (method: PortalMethod) =>
      method === 'email' ? this.mail.available : this.sms.available(tenant);
    return ok({
      methods: read.value.methods.filter(deliverable),
      countryCallingCode: read.value.countryCallingCode,
    });
  }
}
