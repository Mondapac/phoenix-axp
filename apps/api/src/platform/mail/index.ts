// The `platform/mail` barrel (ADR-0010, ADR-0026): what modules use to send mail.
export {
  MAIL_SENDER,
  type MailMessage,
  type MailSender,
  type MailUnavailable,
} from './mail-sender';
