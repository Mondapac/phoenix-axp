import type { MessageKey } from '../_i18n/messages';

// What the sign-in screens tell the visitor when the API refuses. The API answers
// `{ statusCode, code, field? }`; a code the portal has no text for reads as the generic
// failure. Sign-in never says whether an address has an account (ADR-0026 decision 3).

export type ApiAnswer<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly code: string | null };

const BY_CODE: Readonly<Record<string, MessageKey>> = {
  'identity.value.invalid': 'error.invalidAddress',
  'portal.code-invalid': 'error.invalidCode',
  'portal.account-disabled': 'error.disabled',
  'portal.method-unavailable': 'error.unavailable',
  'portal.delivery-failed': 'error.unavailable',
  'portal.unavailable': 'error.unavailable',
  'captcha.invalid': 'error.captcha',
  'rate-limit.exceeded': 'error.tooMany',
};

/** The message for a refused request. */
export function failureMessage(answer: {
  readonly status: number;
  readonly code: string | null;
}): MessageKey {
  const known =
    answer.code !== null && Object.hasOwn(BY_CODE, answer.code) ? BY_CODE[answer.code] : undefined;
  if (known !== undefined) return known;
  if (answer.status === 429) return 'error.tooMany';
  return 'error.generic';
}
