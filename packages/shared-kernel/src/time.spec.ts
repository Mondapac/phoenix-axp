// Through the main entry, so these tests also check the re-export.
import { Temporal } from './index';

// The zones of the two tenant fixtures: Tehran (+03:30, no daylight saving since 2022) and
// Toronto (daylight saving). A tenant's zone is configuration, never a literal in core code.
const TEHRAN = 'Asia/Tehran';
const TORONTO = 'America/Toronto';

const local = (instant: Temporal.Instant, zone: string): string =>
  instant.toZonedDateTimeISO(zone).toString({ timeZoneName: 'never' });

describe('Temporal through the kernel', () => {
  it('is not installed as a global', () => {
    expect((globalThis as { Temporal?: unknown }).Temporal).not.toBe(Temporal);
  });

  it('converts one instant in both fixture zones', () => {
    const instant = Temporal.Instant.from('2026-07-01T02:15:00Z');

    expect(local(instant, TEHRAN)).toBe('2026-07-01T05:45:00+03:30');
    expect(local(instant, TORONTO)).toBe('2026-06-30T22:15:00-04:00');
  });

  it('gives one instant a different local date per zone', () => {
    const instant = Temporal.Instant.from('2026-07-01T21:00:00Z');
    const dateIn = (zone: string): string =>
      instant.toZonedDateTimeISO(zone).toPlainDate().toString();

    expect(dateIn(TEHRAN)).toBe('2026-07-02');
    expect(dateIn(TORONTO)).toBe('2026-07-01');
  });

  describe('on the day daylight saving starts in Toronto (2026-03-08)', () => {
    const before = Temporal.Instant.from('2026-03-08T06:59:59Z');
    const change = Temporal.Instant.from('2026-03-08T07:00:00Z');

    it('moves Toronto from 01:59:59 -05:00 to 03:00:00 -04:00 and leaves Tehran alone', () => {
      expect(local(before, TORONTO)).toBe('2026-03-08T01:59:59-05:00');
      expect(local(change, TORONTO)).toBe('2026-03-08T03:00:00-04:00');
      expect(local(before, TEHRAN)).toBe('2026-03-08T10:29:59+03:30');
      expect(local(change, TEHRAN)).toBe('2026-03-08T10:30:00+03:30');
    });

    it('makes the local day 23 hours long where the clocks change', () => {
      const hoursIn = (zone: string): number =>
        Temporal.PlainDate.from('2026-03-08').toZonedDateTime(zone).hoursInDay;

      expect(hoursIn(TORONTO)).toBe(23);
      expect(hoursIn(TEHRAN)).toBe(24);
    });

    it('has no 02:30 in Toronto: the skipped time is refused or moved forward, on request', () => {
      const skipped = Temporal.PlainDateTime.from('2026-03-08T02:30:00');

      expect(() => skipped.toZonedDateTime(TORONTO, { disambiguation: 'reject' })).toThrow(
        RangeError,
      );
      expect(skipped.toZonedDateTime(TORONTO, { disambiguation: 'compatible' }).toString()).toBe(
        '2026-03-08T03:30:00-04:00[America/Toronto]',
      );
      expect(skipped.toZonedDateTime(TEHRAN, { disambiguation: 'reject' }).toString()).toBe(
        '2026-03-08T02:30:00+03:30[Asia/Tehran]',
      );
    });
  });

  it('repeats 01:00 to 02:00 in Toronto when daylight saving ends (2026-11-01)', () => {
    const firstPass = Temporal.Instant.from('2026-11-01T05:30:00Z');
    const secondPass = Temporal.Instant.from('2026-11-01T06:30:00Z');

    expect(local(firstPass, TORONTO)).toBe('2026-11-01T01:30:00-04:00');
    expect(local(secondPass, TORONTO)).toBe('2026-11-01T01:30:00-05:00');
    expect(Temporal.PlainDate.from('2026-11-01').toZonedDateTime(TORONTO).hoursInDay).toBe(25);
    expect(Temporal.PlainDate.from('2026-11-01').toZonedDateTime(TEHRAN).hoursInDay).toBe(24);
  });

  it('reads a date in the Persian (Jalali) calendar: Nowruz 1405 is 2026-03-21', () => {
    const nowruz = Temporal.PlainDate.from('2026-03-21').withCalendar('persian');
    const eve = Temporal.PlainDate.from('2026-03-20').withCalendar('persian');

    expect([nowruz.year, nowruz.month, nowruz.day]).toEqual([1405, 1, 1]);
    expect([eve.year, eve.month, eve.day]).toEqual([1404, 12, 29]);
    expect(nowruz.withCalendar('iso8601').toString()).toBe('2026-03-21');
  });

  it('adds a duration to an instant without any zone', () => {
    const sixtyMinutes = Temporal.Duration.from({ minutes: 60 });

    expect(Temporal.Instant.from('2026-10-03T15:30:00Z').add(sixtyMinutes).toString()).toBe(
      '2026-10-03T16:30:00Z',
    );
  });

  it('keeps a millisecond instant unchanged through its ISO text and epoch milliseconds', () => {
    const instant = Temporal.Instant.from('2026-10-03T16:00:00.123Z');

    expect(Temporal.Instant.from(instant.toString()).equals(instant)).toBe(true);
    expect(Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds).equals(instant)).toBe(
      true,
    );
    expect(JSON.stringify({ at: instant })).toBe('{"at":"2026-10-03T16:00:00.123Z"}');
  });
});
