import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normaliseForStorage, normaliseInput, toAsciiDigits, toLocaleDigits } from './persian.ts';

describe('Persian input normalisation', () => {
  it('maps Arabic yeh, alef maksura and kaf to the Persian letters', () => {
    assert.equal(normaliseInput('علي كريمى', 'text'), 'علی کریمی');
  });

  it('turns Persian and Arabic-Indic digits into ASCII for identifiers', () => {
    assert.equal(normaliseInput('۰۹۱۲٣٤٥۶۷۸۹', 'identifier'), '09123456789');
    assert.equal(toAsciiDigits('۱۴۰۵/۰۸/۰۵'), '1405/08/05');
  });

  it('keeps one digit script in free text: Arabic-Indic become Persian, ASCII stay', () => {
    assert.equal(normaliseInput('پلاک ١٢ و 7', 'text'), 'پلاک ۱۲ و 7');
  });

  it('keeps the length, so the caret does not move on each keystroke', () => {
    const typed = 'كيك ٣٤ ۵6';
    assert.equal(normaliseInput(typed, 'identifier').length, typed.length);
    assert.equal(normaliseInput(typed, 'text').length, typed.length);
  });

  it('tidies ZWNJ before storage but keeps a meaningful one', () => {
    assert.equal(normaliseForStorage(' می‌‌خواهم ‌بروم ', 'text'), 'می‌خواهم بروم');
  });

  it('shows digits in the locale numbering system and leaves Latin locales alone', () => {
    assert.equal(toLocaleDigits('1405/08/05', 'fa-IR'), '۱۴۰۵/۰۸/۰۵');
    assert.equal(toLocaleDigits('2026-10-27', 'en-CA'), '2026-10-27');
  });
});
