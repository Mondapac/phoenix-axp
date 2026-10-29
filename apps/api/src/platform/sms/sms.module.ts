import { Global, Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { MAIL_SENDER, type MailSender } from '../mail/mail-sender';
import { MailRelaySmsSender, SMS_SENDER, UnconfiguredSmsSender } from './sms-sender';

/**
 * Outgoing SMS (ADR-0026 decision 6). Global; exports `SMS_SENDER` only. `SMS_PROVIDER=none`
 * (the default) answers `sms.unavailable`; `mail-relay` is for development and tests.
 */
@Global()
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG, MAIL_SENDER],
      useFactory: (config: AppConfig, mail: MailSender) =>
        config.smsProvider === 'mail-relay'
          ? new MailRelaySmsSender(mail)
          : new UnconfiguredSmsSender(),
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
