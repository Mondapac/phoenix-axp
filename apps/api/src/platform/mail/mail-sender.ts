import { err, ok } from '@phoenix/shared-kernel';
import type { Clock, Result, TenantContext } from '@phoenix/shared-kernel';
import { Logger } from '@nestjs/common';
import { sendSmtp, SmtpError, type SmtpServer } from './smtp-client';

// Outgoing mail (ADR-0010 `mail`; trigger: the portal's sign-in codes, slice 1.8, ADR-0026).
// One port; the adapter is SMTP to the deployment's own mail server, so an offline install
// needs nothing foreign. Callers send outside any unit of work: it is network I/O.

/** One plain-text message to one address. The address is personal data: never log it. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** The message was not handed to the mail server: not configured, refused or unreachable. */
export interface MailUnavailable {
  readonly code: 'mail.unavailable';
}
const UNAVAILABLE: MailUnavailable = Object.freeze({ code: 'mail.unavailable' });

export interface MailSender {
  /** False when no mail server is configured: every send answers `mail.unavailable`. */
  readonly available: boolean;
  send(tenant: TenantContext, message: MailMessage): Promise<Result<void, MailUnavailable>>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');

/** The mail settings of the deployment (`SMTP_URL`, `MAIL_FROM`). */
export interface MailConfig {
  readonly server: SmtpServer;
  /** The sender address of every message. */
  readonly from: string;
  /** The name the client gives in EHLO and Message-ID: the sender's domain. */
  readonly clientName: string;
}

/** Fails closed: no server is configured. */
export class UnconfiguredMailSender implements MailSender {
  readonly available = false;
  send(): Promise<Result<void, MailUnavailable>> {
    return Promise.resolve(err(UNAVAILABLE));
  }
}

/** Submits each message to the configured SMTP server on its own connection. */
export class SmtpMailSender implements MailSender {
  readonly available = true;
  readonly #logger = new Logger('Mail');

  constructor(
    private readonly config: MailConfig,
    private readonly clock: Clock,
  ) {}

  async send(tenant: TenantContext, message: MailMessage): Promise<Result<void, MailUnavailable>> {
    try {
      await sendSmtp(
        this.config.server,
        {
          from: this.config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          date: new Date(this.clock.now().epochMilliseconds).toUTCString(),
        },
        this.config.clientName,
      );
      return ok(undefined);
    } catch (error) {
      // The reason and the server's reply code only: never the address or the text.
      this.#logger.warn({
        msg: 'mail.send-failed',
        tenantId: tenant.tenantId,
        reason: error instanceof SmtpError ? error.message : 'unexpected',
        replyCode: error instanceof SmtpError ? error.replyCode : null,
      });
      return err(UNAVAILABLE);
    }
  }
}
