import {
  normaliseForStorage,
  normaliseInput,
  normaliseLetters,
  searchKey,
  toAsciiDigits,
} from './persian-text';

describe('Persian text normalisation', () => {
  it('turns Arabic yeh, alef maksura and kaf into the Persian letters', () => {
    expect(normaliseLetters('علي كريمى')).toBe('علی کریمی');
  });

  it('turns Persian and Arabic-Indic digits into ASCII digits', () => {
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩ 42')).toBe('0123456789 0123456789 42');
  });

  it('keeps ASCII digits only in an identifier field', () => {
    expect(normaliseInput('۰۹۱۲٣٤٥', 'identifier')).toBe('0912345');
  });

  it('keeps the length of the value, so the caret does not move', () => {
    for (const mode of ['identifier', 'text'] as const) {
      const typed = 'كد ۱۲ ٣ ي';
      expect(normaliseInput(typed, mode)).toHaveLength(typed.length);
    }
  });

  it('puts every digit of a text field in one script and keeps ZWNJ', () => {
    expect(normaliseInput('پلاك ٣ و ۴ می‌شود', 'text')).toBe('پلاک ۳ و ۴ می‌شود');
  });

  it('tidies ZWNJ and trims before storage', () => {
    expect(normaliseForStorage('  می‌‌شود ‌ها ', 'text')).toBe('می‌شود ها');
  });

  it('gives one search key for the spellings people type', () => {
    const keys = ['می‌شود', 'می شود', 'مي  شود', ' می‌شود '].map(searchKey);
    expect(new Set(keys).size).toBe(1);
    expect(searchKey('Ticket ۱۲')).toBe('ticket 12');
    expect(searchKey('كتاب ٣')).toBe(searchKey('کتاب 3'));
  });
});
