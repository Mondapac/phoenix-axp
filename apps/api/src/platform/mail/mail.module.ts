import { Global, Module } from '@nestjs/common';
import type { Clock } from '@phoenix/shared-kernel';
import { CLOCK } from '../clock/clock.module';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { MAIL_SENDER, SmtpMailSender, UnconfiguredMailSender } from './mail-sender';

/**
 * Outgoing mail over SMTP (ADR-0010, ADR-0026 decision 6). Global; exports `MAIL_SENDER`
 * only. Without `SMTP_URL` every send answers `mail.unavailable`.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) =>
        config.mail === null
          ? new UnconfiguredMailSender()
          : new SmtpMailSender(config.mail, clock),
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
