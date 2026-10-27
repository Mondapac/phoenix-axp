// Persian text normalisation (ADR-0008): one form for input, storage and search, shared by the
// api and the web apps. Nothing here names a language or a locale: callers pick the mode from the
// field (identifier or free text). Every mapping in normaliseInput is one code unit to one code
// unit, so a controlled input can normalise on each keystroke without moving the caret.

const ARABIC_YEH = /[يى]/g; // ي and ى (Arabic yeh, alef maksura) -> ی (U+06CC)
const ARABIC_KAF = /ك/g; // ك -> ک (U+06A9)
const ARABIC_INDIC_DIGIT = /[٠-٩]/g; // ٠..٩
const PERSIAN_DIGIT = /[۰-۹]/g; // ۰..۹
const ZWNJ = '‌';

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;
const ASCII_ZERO = 0x30;

const shift = (from: number, to: number) => (ch: string) =>
  String.fromCharCode(ch.charCodeAt(0) - from + to);

/** The two kinds of field: an identifier keeps ASCII digits, free text keeps Persian ones. */
export type TextMode = 'identifier' | 'text';

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
 * ASCII digits only; `text` fields keep the digits the person typed but in one script
 * (Arabic-Indic become Persian). Both normalise letters. ZWNJ is kept: it is meaningful in Persian.
 */
export function normaliseInput(value: string, mode: TextMode): string {
  const letters = normaliseLetters(value);
  if (mode === 'identifier') return toAsciiDigits(letters);
  return letters.replace(ARABIC_INDIC_DIGIT, shift(ARABIC_INDIC_ZERO, PERSIAN_ZERO));
}

/** Before storage: normaliseInput, a doubled ZWNJ or one next to a space removed, trimmed. */
export function normaliseForStorage(value: string, mode: TextMode): string {
  return normaliseInput(value, mode)
    .replace(/‌{2,}/g, ZWNJ)
    .replace(/‌(?=\s)|(?<=\s)‌/g, '')
    .trim();
}

/**
 * The comparison key of a search term or a searched value: letters normalised, every digit ASCII,
 * ZWNJ read as a space (people type «می شود», «می‌شود» and «میشود»; the first two must meet),
 * whitespace collapsed, case folded. Not for display or storage.
 */
export function searchKey(value: string): string {
  return toAsciiDigits(normaliseLetters(value))
    .replaceAll(ZWNJ, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('und');
}
