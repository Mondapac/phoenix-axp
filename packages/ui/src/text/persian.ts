// Persian text normalisation at input (ADR-0008 decision 6). Every mapping is one code unit to
// one code unit, so a controlled input can normalise on each keystroke without moving the caret.
// Nothing here names a language: callers pick the mode from the field (identifier or free text)
// and the digits for display from the locale's numbering system.

const ARABIC_YEH = /[يى]/g; // ي and ى (Arabic yeh, alef maksura) -> ی (U+06CC)
const ARABIC_KAF = /ك/g; // ك -> ک (U+06A9)
const ARABIC_INDIC_DIGIT = /[٠-٩]/g; // ٠..٩
const PERSIAN_DIGIT = /[۰-۹]/g; // ۰..۹
const ASCII_DIGIT = /[0-9]/g;

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;
const ASCII_ZERO = 0x30;

const shift = (from: number, to: number) => (ch: string) =>
  String.fromCharCode(ch.charCodeAt(0) - from + to);

/** Persian letter forms: Arabic yeh and kaf become their Persian code points. */
export function normaliseLetters(value: string): string {
  return value.replace(ARABIC_YEH, 'ی').replace(ARABIC_KAF, 'ک');
}

/** Persian and Arabic-Indic digits become ASCII digits (identifiers, numbers, dates). */
export function toAsciiDigits(value: string): string {
  return value
    .replace(PERSIAN_DIGIT, shift(PERSIAN_ZERO, ASCII_ZERO))
    .replace(ARABIC_INDIC_DIGIT, shift(ARABIC_INDIC_ZERO, ASCII_ZERO));
}

/**
 * Input normalisation for a field. `identifier` fields (national code, phone, postal code) keep
 * ASCII digits only; `text` fields keep the digits the person typed but in one script (Arabic-Indic
 * become Persian, so search and comparison see one form). Both normalise letters.
 * ZWNJ is kept (it is meaningful in Persian); a ZWNJ next to a space or doubled is removed.
 */
export function normaliseInput(value: string, mode: 'identifier' | 'text'): string {
  const letters = normaliseLetters(value);
  if (mode === 'identifier') return toAsciiDigits(letters);
  return letters.replace(ARABIC_INDIC_DIGIT, shift(ARABIC_INDIC_ZERO, PERSIAN_ZERO));
}

/** Final clean-up before storage: what normaliseInput does plus ZWNJ tidying and trimming. */
export function normaliseForStorage(value: string, mode: 'identifier' | 'text'): string {
  return normaliseInput(value, mode)
    .replace(/‌{2,}/g, '‌')
    .replace(/‌(?=\s)|(?<=\s)‌/g, '')
    .trim();
}

/** The numbering system a locale displays digits in ('latn', 'arabext', 'arab', ...). */
export function numberingSystemOf(locale: string): string {
  return new Intl.NumberFormat(locale).resolvedOptions().numberingSystem;
}

const ZERO_OF: Record<string, number> = { arabext: PERSIAN_ZERO, arab: ARABIC_INDIC_ZERO };

/** ASCII digits shown in the locale's own digits (display only; values stay ASCII). */
export function toLocaleDigits(value: string, locale: string): string {
  const zero = ZERO_OF[numberingSystemOf(locale)];
  return zero === undefined ? value : value.replace(ASCII_DIGIT, shift(ASCII_ZERO, zero));
}
