import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

/**
 * A user task's deadline (ADR-0025; owner decision D4): a number of calendar days or hours, or
 * of working days counted on the tenant's working calendar. The modeller sets it per task; the
 * core computes the due time when it first sees the task. Pure, no I/O.
 */
export interface Deadline {
  readonly amount: number;
  readonly unit: 'days' | 'hours';
  /** `working` skips the tenant's weekend days and holidays; days only. */
  readonly count: 'calendar' | 'working';
}

export const DEADLINE_COUNTS = ['calendar', 'working'] as const;
export const MAX_DEADLINE_DAYS = 365;
export const MAX_DEADLINE_HOURS = 720;

/** `P<n>D` or `PT<n>H`: the only durations a deadline takes. */
const DURATION = /^P(?:([1-9][0-9]{0,2})D|T([1-9][0-9]{0,2})H)$/;

/**
 * The deadline of `due` (an ISO 8601 duration) counted as `count` (calendar when absent), or
 * null when either is not one the core takes: working hours are not counted.
 */
export function parseDeadline(due: string, count: string | undefined): Deadline | null {
  const match = DURATION.exec(due);
  if (match === null) return null;
  const counted = count ?? 'calendar';
  if (counted !== 'calendar' && counted !== 'working') return null;
  if (match[1] !== undefined) {
    const amount = Number(match[1]);
    return amount > MAX_DEADLINE_DAYS ? null : { amount, unit: 'days', count: counted };
  }
  const amount = Number(match[2]);
  if (amount > MAX_DEADLINE_HOURS || counted === 'working') return null;
  return { amount, unit: 'hours', count: 'calendar' };
}

/** The deadline as the modeller wrote it: `P3D` or `PT4H`. */
export const durationOf = (deadline: Deadline): string =>
  deadline.unit === 'days' ? `P${deadline.amount}D` : `PT${deadline.amount}H`;

/**
 * A tenant's working calendar (D4): the ISO weekdays that are not worked (1 = Monday ... 7 =
 * Sunday) and the holidays, as ISO dates in the tenant's time zone. The tenant enters it; there
 * is no default source of holidays, and a tenant that entered nothing works every day.
 */
export interface WorkingCalendar {
  readonly weekendDays: ReadonlySet<number>;
  readonly holidays: ReadonlySet<string>;
}

export const EMPTY_WORKING_CALENDAR: WorkingCalendar = Object.freeze({
  weekendDays: new Set<number>(),
  holidays: new Set<string>(),
});

/** At least one weekday is worked, so a count of working days always ends. */
export const MAX_WEEKEND_DAYS = 6;
export const MAX_HOLIDAYS = 1000;
const FIRST_HOLIDAY = Temporal.PlainDate.from('2000-01-01');
const LAST_HOLIDAY = Temporal.PlainDate.from('2100-12-31');
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export type InvalidCalendar = {
  readonly code: 'process.calendar.invalid';
  readonly field: 'weekendDays' | 'holidays';
};

/** A calendar as the tenant entered it, checked: sorted and without repeats. */
export function checkWorkingCalendar(
  weekendDays: readonly number[],
  holidays: readonly string[],
): Result<{ weekendDays: number[]; holidays: string[] }, InvalidCalendar> {
  const days = new Set(weekendDays);
  if (
    days.size !== weekendDays.length ||
    days.size > MAX_WEEKEND_DAYS ||
    weekendDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    return err({ code: 'process.calendar.invalid', field: 'weekendDays' });
  }
  const dates = new Set(holidays);
  if (dates.size !== holidays.length || dates.size > MAX_HOLIDAYS) {
    return err({ code: 'process.calendar.invalid', field: 'holidays' });
  }
  for (const holiday of holidays) {
    if (!ISO_DATE.test(holiday))
      return err({ code: 'process.calendar.invalid', field: 'holidays' });
    let date: Temporal.PlainDate;
    try {
      date = Temporal.PlainDate.from(holiday, { overflow: 'reject' });
    } catch {
      return err({ code: 'process.calendar.invalid', field: 'holidays' });
    }
    if (
      Temporal.PlainDate.compare(date, FIRST_HOLIDAY) < 0 ||
      Temporal.PlainDate.compare(date, LAST_HOLIDAY) > 0
    ) {
      return err({ code: 'process.calendar.invalid', field: 'holidays' });
    }
  }
  return ok({
    weekendDays: [...days].sort((a, b) => a - b),
    holidays: [...dates].sort(),
  });
}

const isWorkingDay = (date: Temporal.PlainDate, calendar: WorkingCalendar): boolean =>
  !calendar.weekendDays.has(date.dayOfWeek) && !calendar.holidays.has(date.toString());

/**
 * When a task opened at `start` is due, in the tenant's `timeZone`. Calendar days and hours
 * are added in the zone (a day across a daylight-saving change is still a day). Working days
 * keep the time of day and move to the n-th working day after the start date: a task opened on
 * a holiday or after hours counts from the next day either way.
 */
export function dueAt(
  start: Temporal.Instant,
  timeZone: string,
  deadline: Deadline,
  calendar: WorkingCalendar,
): Temporal.Instant {
  const opened = start.toZonedDateTimeISO(timeZone);
  if (deadline.unit === 'hours') return opened.add({ hours: deadline.amount }).toInstant();
  if (deadline.count === 'calendar') return opened.add({ days: deadline.amount }).toInstant();
  let day = opened;
  // Bounded: at least one weekday is worked and the holidays are at most MAX_HOLIDAYS.
  const limit = (deadline.amount + MAX_HOLIDAYS + 1) * 7;
  for (let counted = 0, steps = 0; counted < deadline.amount; steps += 1) {
    if (steps > limit) throw new RangeError('the working calendar has no working day');
    day = day.add({ days: 1 });
    if (isWorkingDay(day.toPlainDate(), calendar)) counted += 1;
  }
  return day.toInstant();
}
