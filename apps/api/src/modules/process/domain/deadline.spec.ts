import { Temporal } from '@phoenix/shared-kernel';
import { TEST_TENANTS } from '../../../../test/support/test-config';
import { testTenantRegistry } from '../../../../test/support/process-test-support';
import {
  checkWorkingCalendar,
  dueAt,
  durationOf,
  EMPTY_WORKING_CALENDAR,
  parseDeadline,
  type WorkingCalendar,
} from './deadline';

// Owner decision D4: calendar or working days per deadline, on a per-tenant working calendar.
// Every rule runs in both tenant fixtures' time zones (Asia/Tehran, America/Toronto).

describe('parseDeadline', () => {
  it('reads whole days and hours, calendar by default', () => {
    expect(parseDeadline('P3D', undefined)).toEqual({ amount: 3, unit: 'days', count: 'calendar' });
    expect(parseDeadline('P10D', 'working')).toEqual({
      amount: 10,
      unit: 'days',
      count: 'working',
    });
    expect(parseDeadline('PT4H', 'calendar')).toEqual({
      amount: 4,
      unit: 'hours',
      count: 'calendar',
    });
  });

  it.each([
    ['P0D', undefined],
    ['P366D', undefined],
    ['PT721H', undefined],
    ['P1W', undefined],
    ['P1DT2H', undefined],
    ['PT4H', 'working'],
    ['P2D', 'business'],
    ['p2d', undefined],
  ])('refuses %s counted as %s', (due, count) => {
    expect(parseDeadline(due, count)).toBeNull();
  });

  it('writes a deadline back as the modeller wrote it', () => {
    expect(durationOf({ amount: 2, unit: 'days', count: 'working' })).toBe('P2D');
    expect(durationOf({ amount: 6, unit: 'hours', count: 'calendar' })).toBe('PT6H');
  });
});

describe('checkWorkingCalendar', () => {
  it('sorts and accepts weekend days and ISO holidays', () => {
    expect(checkWorkingCalendar([6, 5], ['2026-11-05', '2026-03-21'])).toEqual({
      ok: true,
      value: { weekendDays: [5, 6], holidays: ['2026-03-21', '2026-11-05'] },
    });
  });

  it.each([
    [[1, 2, 3, 4, 5, 6, 7], [], 'weekendDays'],
    [[0], [], 'weekendDays'],
    [[5, 5], [], 'weekendDays'],
    [[1.5], [], 'weekendDays'],
    [[], ['2026-02-30'], 'holidays'],
    [[], ['2026-1-5'], 'holidays'],
    [[], ['1999-12-31'], 'holidays'],
    [[], ['2026-11-05', '2026-11-05'], 'holidays'],
  ])('refuses weekend %j and holidays %j', (weekendDays, holidays, field) => {
    expect(checkWorkingCalendar(weekendDays, holidays)).toEqual({
      ok: false,
      error: { code: 'process.calendar.invalid', field },
    });
  });
});

describe.each(TEST_TENANTS)('dueAt in the time zone of tenant %s', (code) => {
  const zone = testTenantRegistry().get(code as never).timeZone;
  /** Wednesday 2026-11-04, 10:00 local. */
  const wednesday = Temporal.ZonedDateTime.from({
    timeZone: zone,
    year: 2026,
    month: 11,
    day: 4,
    hour: 10,
  });
  const calendar: WorkingCalendar = {
    weekendDays: new Set([5, 6]),
    holidays: new Set(['2026-11-05']),
  };

  it('adds calendar days and hours in the zone', () => {
    const start = wednesday.toInstant();
    expect(dueAt(start, zone, { amount: 3, unit: 'days', count: 'calendar' }, calendar)).toEqual(
      wednesday.add({ days: 3 }).toInstant(),
    );
    expect(dueAt(start, zone, { amount: 4, unit: 'hours', count: 'calendar' }, calendar)).toEqual(
      start.add({ hours: 4 }),
    );
  });

  it('skips weekend days and holidays for working days, keeping the time of day', () => {
    // Thu holiday, Fri and Sat weekend: the first working day is Sunday, the second Monday.
    const due = dueAt(
      wednesday.toInstant(),
      zone,
      { amount: 2, unit: 'days', count: 'working' },
      calendar,
    ).toZonedDateTimeISO(zone);
    expect(due.toPlainDate().toString()).toBe('2026-11-09');
    expect(due.hour).toBe(10);
  });

  it('counts from the next day when the task opens on a day off', () => {
    const friday = wednesday.add({ days: 2 });
    const due = dueAt(
      friday.toInstant(),
      zone,
      { amount: 1, unit: 'days', count: 'working' },
      calendar,
    ).toZonedDateTimeISO(zone);
    expect(due.toPlainDate().toString()).toBe('2026-11-08');
  });

  it('matches a holiday on the local date, not the UTC one', () => {
    // 2026-11-05 00:30 local is still the 4th in UTC east of Greenwich, the 5th west of it.
    const justAfterMidnight = Temporal.ZonedDateTime.from({
      timeZone: zone,
      year: 2026,
      month: 11,
      day: 3,
      hour: 0,
      minute: 30,
    });
    const due = dueAt(
      justAfterMidnight.toInstant(),
      zone,
      { amount: 2, unit: 'days', count: 'working' },
      { weekendDays: new Set(), holidays: new Set(['2026-11-05']) },
    ).toZonedDateTimeISO(zone);
    // Wednesday the 4th, the 5th off, then Friday the 6th, at 00:30 local.
    expect(due.toPlainDate().toString()).toBe('2026-11-06');
    expect([due.hour, due.minute]).toEqual([0, 30]);
  });

  it('crosses the year end and the last day a holiday may fall on', () => {
    const lateDecember = Temporal.ZonedDateTime.from({
      timeZone: zone,
      year: 2100,
      month: 12,
      day: 30,
      hour: 10,
    });
    const due = dueAt(
      lateDecember.toInstant(),
      zone,
      { amount: 2, unit: 'days', count: 'working' },
      { weekendDays: new Set(), holidays: new Set(['2100-12-31']) },
    ).toZonedDateTimeISO(zone);
    expect(due.toPlainDate().toString()).toBe('2101-01-02');
  });

  it('refuses a calendar with no working day instead of looping', () => {
    expect(() =>
      dueAt(
        wednesday.toInstant(),
        zone,
        { amount: 1, unit: 'days', count: 'working' },
        { weekendDays: new Set([1, 2, 3, 4, 5, 6, 7]), holidays: new Set() },
      ),
    ).toThrow(RangeError);
  });

  it('works every day without a calendar', () => {
    expect(
      dueAt(
        wednesday.toInstant(),
        zone,
        { amount: 2, unit: 'days', count: 'working' },
        EMPTY_WORKING_CALENDAR,
      ),
    ).toEqual(wednesday.add({ days: 2 }).toInstant());
  });
});

describe('dueAt across a daylight-saving change (America/Toronto, 2026-11-01)', () => {
  it('keeps the local time of day for a calendar day', () => {
    const zone = 'America/Toronto';
    const before = Temporal.ZonedDateTime.from({
      timeZone: zone,
      year: 2026,
      month: 10,
      day: 31,
      hour: 9,
    });
    const due = dueAt(
      before.toInstant(),
      zone,
      { amount: 1, unit: 'days', count: 'calendar' },
      EMPTY_WORKING_CALENDAR,
    );
    expect(due.toZonedDateTimeISO(zone).hour).toBe(9);
    expect(due.since(before.toInstant()).total('hours')).toBe(25);
  });

  it('keeps the local time of day for working days across the change', () => {
    const zone = 'America/Toronto';
    const friday = Temporal.ZonedDateTime.from({
      timeZone: zone,
      year: 2026,
      month: 10,
      day: 30,
      hour: 9,
    });
    const due = dueAt(
      friday.toInstant(),
      zone,
      { amount: 1, unit: 'days', count: 'working' },
      { weekendDays: new Set([6, 7]), holidays: new Set() },
    ).toZonedDateTimeISO(zone);
    expect(due.toPlainDate().toString()).toBe('2026-11-02');
    expect(due.hour).toBe(9);
  });

  it('moves a start in the spring-forward gap to a real local time', () => {
    const zone = 'America/Toronto';
    // 2026-03-08 02:30 does not exist in Toronto; the start instant is 07:30Z, 03:30 local.
    const start = Temporal.Instant.from('2026-03-08T07:30:00Z');
    const due = dueAt(
      start,
      zone,
      { amount: 1, unit: 'days', count: 'working' },
      EMPTY_WORKING_CALENDAR,
    ).toZonedDateTimeISO(zone);
    expect(due.toPlainDate().toString()).toBe('2026-03-09');
    expect(due.hour).toBe(3);
  });
});
