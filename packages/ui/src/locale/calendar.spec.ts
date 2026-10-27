import { Temporal } from '@phoenix/shared-kernel';
import { TENANTS } from '../test-tenants';
import {
  addDays,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  fromCalendar,
  isoWeekday,
  parseEditableText,
  toCalendar,
  toEditableText,
} from './calendar';

describe.each(TENANTS)('calendar helpers in the calendar of tenant $code', (tenant) => {
  const { calendar, defaultLocale: locale } = tenant;

  it('agrees with the kernel Temporal on every day of 2011..2051 and round-trips', () => {
    let iso = '2011-03-21';
    for (let i = 0; i < 365 * 40 + 10; i += 1) {
      const expected = Temporal.PlainDate.from(iso).withCalendar(calendar);
      const got = toCalendar(iso, calendar);
      expect(got).toEqual({ year: expected.year, month: expected.month, day: expected.day });
      expect(fromCalendar(got, calendar)).toBe(iso);
      iso = addDays(iso, 1);
    }
  });

  it('edits a date as Y/M/D text in the calendar and parses it back', () => {
    const text = toEditableText('2026-10-27', calendar);
    expect(parseEditableText(text, calendar)).toBe('2026-10-27');
    expect(parseEditableText('2026/13/1', calendar)).toBeNull();
    expect(parseEditableText('hello', calendar)).toBeNull();
  });

  it('formats a date in the locale and the calendar of the tenant', () => {
    const expected = new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(Date.UTC(2026, 9, 27));
    expect(formatDate('2026-10-27', { locale, calendar })).toBe(expected);
    expect(formatDate('not-a-date', { locale, calendar })).toBe('not-a-date');
  });

  it('reads the first day of the week from the locale', () => {
    expect(firstDayOfWeek(locale)).toBeGreaterThanOrEqual(1);
    expect(firstDayOfWeek(locale)).toBeLessThanOrEqual(7);
  });
});

describe('the Persian (Jalali) calendar', () => {
  it('knows Nowruz 1405 and the end of Esfand in leap and common years', () => {
    expect(fromCalendar({ year: 1405, month: 1, day: 1 }, 'persian')).toBe('2026-03-21');
    expect(daysInMonth(1403, 12, 'persian')).toBe(30);
    expect(daysInMonth(1404, 12, 'persian')).toBe(29);
    expect(fromCalendar({ year: 1404, month: 12, day: 30 }, 'persian')).toBeNull();
    expect(fromCalendar({ year: 2026, month: 2, day: 30 }, 'gregory')).toBeNull();
    expect(parseEditableText('1405/8/5', 'persian')).toBe('2026-10-27');
  });

  it('starts the week on Saturday in Iran and on Sunday in Canada', () => {
    expect(firstDayOfWeek('fa-IR')).toBe(6);
    expect(firstDayOfWeek('en-CA')).toBe(7);
    expect(isoWeekday('2026-10-27')).toBe(2);
  });
});
