import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { MailSender } from '../../../../platform/mail';
import type { SmsSender } from '../../../../platform/sms';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_PORTAL_SIGN_IN_MANAGE } from '../../contracts/permissions';
import type { PortalMethod, PortalSignInSettings } from '../../domain/portal';
import type { PortalRepository } from '../portal/portal.repository';

export interface PortalSignInSettingsView extends PortalSignInSettings {
  /** Which methods this deployment can deliver now (a mail server, an SMS provider). */
  readonly deliverable: Readonly<Record<PortalMethod, boolean>>;
}

/** The tenant's portal sign-in settings, for studio (ADR-0026 decision 2). */
export class ViewPortalSignInSettings extends UseCase<void, PortalSignInSettingsView, never> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-portal-sign-in-settings',
    rule: { kind: 'permissions', allOf: [IDENTITY_PORTAL_SIGN_IN_MANAGE.key] },
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

  protected async handle(context: CallContext): Promise<Result<PortalSignInSettingsView, never>> {
    const { tenant } = context;
    const read = await this.unitOfWork.run<PortalSignInSettings, never>(
      tenant,
      async () => ok(await this.portal.settings(tenant)),
      { readOnly: true },
    );
    if (!read.ok) return read;
    return ok({
      ...read.value,
      deliverable: { email: this.mail.available, mobile: this.sms.available(tenant) },
    });
  }
}
