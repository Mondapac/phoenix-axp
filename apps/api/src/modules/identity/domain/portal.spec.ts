import {
  asciiDigits,
  maskAddress,
  parseAddress,
  parseCountryCallingCode,
  parseMethods,
} from './portal';
import { TEST_TENANTS } from '../../../../test/support/test-config';

// Portal sign-in values (ADR-0026): methods, calling codes and addresses, read the same way
// for every tenant; only the tenant's calling code changes how a national number reads.

const CALLING_CODE: Readonly<Record<string, string>> = { 'demo-fa': '98', 'demo-en': '44' };

describe.each(TEST_TENANTS)('portal sign-in values in tenant %s', (code) => {
  const callingCode = CALLING_CODE[code]!;

  it('takes each method once, in catalogue order', () => {
    expect(parseMethods(['mobile', 'email'])).toEqual({ ok: true, value: ['email', 'mobile'] });
    expect(parseMethods([])).toEqual({ ok: true, value: [] });
    for (const bad of [['email', 'email'], ['fax'], ['email', 'mobile', 'post']]) {
      expect(parseMethods(bad)).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'methods' },
      });
    }
  });

  it('reads a calling code with or without "+" and in Persian digits', () => {
    expect(parseCountryCallingCode(`+${callingCode}`)).toEqual({ ok: true, value: callingCode });
    expect(parseCountryCallingCode(asciiToPersian(callingCode))).toEqual({
      ok: true,
      value: callingCode,
    });
    expect(parseCountryCallingCode(null)).toEqual({ ok: true, value: null });
    for (const bad of ['0', '12345', 'x1', '']) expect(parseCountryCallingCode(bad).ok).toBe(false);
  });

  it('stores an email in lower case and refuses what is not a mailbox', () => {
    expect(parseAddress('email', '  Zahra.Ahmadi@Example.TEST ', callingCode)).toEqual({
      ok: true,
      value: 'zahra.ahmadi@example.test',
    });
    for (const bad of [
      'a@b',
      'a..b@example.test',
      'a b@example.test',
      '@example.test',
      'زهرا@example.test',
    ]) {
      expect(parseAddress('email', bad, callingCode).ok).toBe(false);
    }
    expect(parseAddress('email', `${'a'.repeat(250)}@example.test`, callingCode).ok).toBe(false);
  });

  it('turns a national mobile number into E.164 with the tenant calling code', () => {
    expect(parseAddress('mobile', asciiToPersian('0912 345-6789'), callingCode)).toEqual({
      ok: true,
      value: `+${callingCode}9123456789`,
    });
    expect(parseAddress('mobile', '00447700900123', callingCode)).toEqual({
      ok: true,
      value: '+447700900123',
    });
    expect(parseAddress('mobile', '+98 (912) 345 6789', null)).toEqual({
      ok: true,
      value: '+989123456789',
    });
    // Without a calling code only international numbers are read.
    expect(parseAddress('mobile', '09123456789', null).ok).toBe(false);
    for (const bad of ['+0123456789', '+12', '+1234567890123456', 'abc', '912345']) {
      expect(parseAddress('mobile', bad, callingCode).ok).toBe(false);
    }
  });

  it('masks an address for display', () => {
    expect(maskAddress('email', 'zahra@example.test')).toBe('za***@example.test');
    expect(maskAddress('email', 'z@example.test')).toBe('***@example.test');
    expect(maskAddress('mobile', '+989123456789')).toBe('+989***789');
  });
});

function asciiToPersian(text: string): string {
  return text.replace(/[0-9]/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)));
}

describe('asciiDigits', () => {
  it('reads Persian and Arabic-Indic digits', () => {
    expect(asciiDigits('۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩ 42')).toBe('0123456789 0123456789 42');
  });
});
