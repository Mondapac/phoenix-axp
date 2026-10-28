import { CODE_TTL_SECONDS } from '../../domain/portal';

// The text of a sign-in code message, in the tenant's language (ADR-0022 decision 3: Persian
// and English in phase 1; another language falls back to English until platform/i18n holds
// translations as data). The code is in ASCII digits, which phones offer to fill in.

interface CodeText {
  readonly subject: (site: string) => string;
  readonly body: (site: string, code: string, minutes: number) => string;
}

const TEXTS: Readonly<Record<string, CodeText>> = {
  fa: {
    subject: (site) => `کد ورود به ${site}`,
    body: (site, code, minutes) =>
      `کد ورود شما به ${site}: ${code}\nاین کد تا ${minutes} دقیقه معتبر است. آن را به کسی ندهید.`,
  },
  en: {
    subject: (site) => `Your ${site} sign-in code`,
    body: (site, code, minutes) =>
      `Your ${site} sign-in code: ${code}\nIt is valid for ${minutes} minutes. Do not share it.`,
  },
};

/** The subject and text of a code message for a tenant's default locale. */
export function codeMessage(
  locale: string,
  site: string,
  code: string,
): { readonly subject: string; readonly text: string } {
  const language = locale.split('-')[0] ?? '';
  const texts = TEXTS[language] ?? TEXTS.en;
  const minutes = CODE_TTL_SECONDS / 60;
  return { subject: texts.subject(site), text: texts.body(site, code, minutes) };
}
