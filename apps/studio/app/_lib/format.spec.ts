import { formatInstantDate } from './format';

// The two tenant fixtures (config/tenants): different locale, calendar and time zone.
const FA = { locale: 'fa-IR', calendar: 'persian', timeZone: 'Asia/Tehran' };
const EN = { locale: 'en-CA', calendar: 'gregory', timeZone: 'America/Toronto' };

describe('formatInstantDate', () => {
  it('reads an instant in the Jalali calendar with Persian digits for demo-fa', () => {
    expect(formatInstantDate('2026-10-28T08:00:00Z', FA)).toBe('۶ آبان ۱۴۰۵');
  });

  it('reads it in the Gregorian calendar for demo-en', () => {
    expect(formatInstantDate('2026-10-28T08:00:00Z', EN)).toBe('October 28, 2026');
  });

  it('takes the date in the tenant’s time zone, not UTC', () => {
    // 22:00 UTC on the 27th is already the 28th in Tehran, still the 27th in Toronto.
    expect(formatInstantDate('2026-10-27T22:00:00Z', FA)).toBe('۶ آبان ۱۴۰۵');
    expect(formatInstantDate('2026-10-27T22:00:00Z', EN)).toBe('October 27, 2026');
  });

  it('shows a text that is not an instant as it is', () => {
    expect(formatInstantDate('not a date', FA)).toBe('not a date');
  });
});
