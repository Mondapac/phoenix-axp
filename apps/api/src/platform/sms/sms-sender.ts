import { err } from '@phoenix/shared-kernel';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import type { MailSender } from '../mail/mail-sender';

// Outgoing SMS (ADR-0026 decision 6; owner decision P1: each tenant connects its own SMS
// provider, and none is built in). The port takes the tenant, so a provider adapter per tenant
// can bind behind it when the first tenant names one (ADR-0010; docs/platform-deferred.md).
// Callers send outside any unit of work: it is network I/O.

/** One text to one mobile number in E.164. The number is personal data: never log it. */
export interface SmsMessage {
  readonly to: string;
  readonly text: string;
}

/** The text was not handed to a provider: none is configured, or it refused. */
export interface SmsUnavailable {
  readonly code: 'sms.unavailable';
}
const UNAVAILABLE: SmsUnavailable = Object.freeze({ code: 'sms.unavailable' });

export interface SmsSender {
  /** False when no provider serves the tenant: every send answers `sms.unavailable`. */
  available(tenant: TenantContext): boolean;
  send(tenant: TenantContext, message: SmsMessage): Promise<Result<void, SmsUnavailable>>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/** The deployment's choice (`SMS_PROVIDER`). */
export const SMS_PROVIDERS = ['none', 'mail-relay'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

/** Fails closed: no provider. */
export class UnconfiguredSmsSender implements SmsSender {
  available(): boolean {
    return false;
  }
  send(): Promise<Result<void, SmsUnavailable>> {
    return Promise.resolve(err(UNAVAILABLE));
  }
}

/**
 * Development and test only (refused in production by the configuration): each text goes as a
 * mail to `sms+<digits>@sms.invalid` through the mail port, where the local mail catcher shows
 * it. No text is ever written to a log.
 */
export class MailRelaySmsSender implements SmsSender {
  constructor(private readonly mail: MailSender) {}

  available(): boolean {
    return this.mail.available;
  }

  async send(tenant: TenantContext, message: SmsMessage): Promise<Result<void, SmsUnavailable>> {
    const digits = message.to.replace(/\D/g, '');
    const sent = await this.mail.send(tenant, {
      to: `sms+${digits}@sms.invalid`,
      subject: `SMS ${message.to}`,
      text: message.text,
    });
    return sent.ok ? sent : err(UNAVAILABLE);
  }
}
