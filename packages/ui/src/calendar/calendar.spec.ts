import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Temporal } from '@phoenix/shared-kernel';
import {
  addDays,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  fromCalendar,
  isoWeekday,
  parseEditableText,
  toCalendar,
} from './calendar.ts';

describe('calendar conversions', () => {
  it('agrees with the kernel Temporal (persian and gregory) on every day of 1390..1430 AP', () => {
    let iso = '2011-03-21'; // 1390-01-01 AP
    for (let i = 0; i < 365 * 40 + 10; i += 1) {
      for (const calendar of ['persian', 'gregory']) {
        const expected = Temporal.PlainDate.from(iso).withCalendar(calendar);
        const got = toCalendar(iso, calendar);
        assert.deepEqual(got, { year: expected.year, month: expected.month, day: expected.day });
        assert.equal(fromCalendar(got, calendar), iso);
      }
      iso = addDays(iso, 1);
    }
  });

  it('knows Nowruz 1405 and the end of Esfand in leap and common years', () => {
    assert.equal(fromCalendar({ year: 1405, month: 1, day: 1 }, 'persian'), '2026-03-21');
    assert.equal(daysInMonth(1403, 12, 'persian'), 30); // 1403 is leap
    assert.equal(daysInMonth(1404, 12, 'persian'), 29);
    assert.equal(fromCalendar({ year: 1404, month: 12, day: 30 }, 'persian'), null);
    assert.equal(fromCalendar({ year: 2026, month: 2, day: 30 }, 'gregory'), null);
  });

  it('parses typed Y/M/D text in the viewer calendar', () => {
    assert.equal(parseEditableText('1405/8/5', 'persian'), '2026-10-27');
    assert.equal(parseEditableText('2026-10-27', 'gregory'), '2026-10-27');
    assert.equal(parseEditableText('1405/13/1', 'persian'), null);
    assert.equal(parseEditableText('hello', 'persian'), null);
  });

  it('formats in the locale digits and the calendar, with no hardcoded language', () => {
    assert.equal(formatDate('2026-10-27', { locale: 'fa-IR', calendar: 'persian' }), '۵ آبان ۱۴۰۵');
    assert.equal(
      formatDate('2026-10-27', { locale: 'en-CA', calendar: 'gregory' }),
      'October 27, 2026',
    );
  });

  it('reads the first day of the week from the locale', () => {
    assert.equal(firstDayOfWeek('fa-IR'), 6); // Saturday
    assert.equal(firstDayOfWeek('en-CA'), 7); // Sunday
    assert.equal(isoWeekday('2026-10-27'), 2); // a Tuesday
  });
});
