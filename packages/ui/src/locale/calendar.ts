// Calendar arithmetic for display and input (ADR-0008 decision 3). Storage is always an ISO date
// (YYYY-MM-DD); the calendar is a property of the viewer (tenant, site or user setting), never
// a literal here. Conversions use the platform's Intl calendars (ICU), so any calendar the
// runtime supports works; calendar.spec.ts checks them against the kernel's Temporal.
//
// The kernel's Temporal is not loaded in the browser; Intl is enough for display and input.

export interface CalendarDate {
  year: number;
  month: number; // 1-based
  day: number;
}

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(calendar: string): Intl.DateTimeFormat {
  let formatter = formatters.get(calendar);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    formatters.set(calendar, formatter);
  }
  return formatter;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds at UTC midnight of an ISO date, or null if the text is not a real date. */
export function isoToEpochDay(iso: string): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms / DAY_MS;
}

export function epochDayToIso(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const epochDay = isoToEpochDay(iso);
  if (epochDay === null) throw new RangeError(`not an ISO date: ${iso}`);
  return epochDayToIso(epochDay + days);
}

/** An ISO date read in a calendar. */
export function toCalendar(iso: string, calendar: string): CalendarDate {
  const epochDay = isoToEpochDay(iso);
  if (epochDay === null) throw new RangeError(`not an ISO date: ${iso}`);
  return partsOf(epochDay, calendar);
}

function partsOf(epochDay: number, calendar: string): CalendarDate {
  const parts = partsFormatter(calendar).formatToParts(new Date(epochDay * DAY_MS));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const compare = (a: CalendarDate, b: CalendarDate) =>
  a.year - b.year || a.month - b.month || a.day - b.day;

/**
 * A calendar date as an ISO date, or null when it does not exist (Esfand 30 in a common year,
 * February 30). Starts from an estimate and walks by the difference, so it needs no table of the
 * calendar's rules. The estimate assumes a solar calendar whose years are close to the
 * Gregorian year with a fixed offset (true for gregory and persian); a lunar calendar would
 * need a better first guess.
 */
export function fromCalendar(date: CalendarDate, calendar: string): string | null {
  if (date.month < 1 || date.month > 13 || date.day < 1 || date.day > 31) return null;
  const anchor = partsOf(0, calendar); // 1970-01-01 in that calendar
  let epochDay = Math.round(
    (date.year - anchor.year) * 365.2425 +
      (date.month - anchor.month) * 30.44 +
      (date.day - anchor.day),
  );
  for (let step = 0; step < 8; step += 1) {
    const here = partsOf(epochDay, calendar);
    const diff = compare(date, here);
    if (diff === 0) return epochDayToIso(epochDay);
    const delta =
      (date.year - here.year) * 365 + (date.month - here.month) * 29 + (date.day - here.day);
    epochDay += delta === 0 ? Math.sign(diff) : delta;
  }
  // Walked past it: the date is not in the calendar (or the estimate failed; both mean "no").
  for (let probe = epochDay - 3; probe <= epochDay + 3; probe += 1) {
    if (compare(date, partsOf(probe, calendar)) === 0) return epochDayToIso(probe);
  }
  return null;
}

export function daysInMonth(year: number, month: number, calendar: string): number {
  const first = fromCalendar({ year, month, day: 1 }, calendar);
  if (first === null) throw new RangeError('no such month');
  let days = 28;
  while (days < 31 && fromCalendar({ year, month, day: days + 1 }, calendar) !== null) days += 1;
  return days;
}

/** The first day of the week for a locale, 1 = Monday ... 7 = Sunday (Intl Locale week info). */
export function firstDayOfWeek(locale: string): number {
  const info = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  return info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
}

/** ISO weekday of an ISO date, 1 = Monday ... 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const epochDay = isoToEpochDay(iso);
  if (epochDay === null) throw new RangeError(`not an ISO date: ${iso}`);
  return ((((epochDay + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday
}

export interface DateFormatContext {
  locale: string;
  calendar: string;
}

/** A date for reading, in the viewer's locale and calendar (digits follow the locale). */
export function formatDate(
  iso: string,
  { locale, calendar }: DateFormatContext,
  style: 'long' | 'numeric' = 'long',
): string {
  const epochDay = isoToEpochDay(iso);
  if (epochDay === null) return iso;
  return new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
    timeZone: 'UTC',
    ...(style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' }),
  }).format(new Date(epochDay * DAY_MS));
}

/** The calendar month name in the viewer's locale. */
export function monthName(year: number, month: number, ctx: DateFormatContext): string {
  const iso = fromCalendar({ year, month, day: 1 }, ctx.calendar);
  if (iso === null) return String(month);
  return new Intl.DateTimeFormat(`${ctx.locale}-u-ca-${ctx.calendar}`, {
    timeZone: 'UTC',
    month: 'long',
  }).format(new Date((isoToEpochDay(iso) ?? 0) * DAY_MS));
}

/** Weekday names (long and narrow) in the viewer's locale, keyed by ISO weekday. */
export function weekdayNames(locale: string): Map<number, { long: string; short: string }> {
  const names = new Map<number, { long: string; short: string }>();
  const long = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' });
  const short = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' });
  for (let i = 0; i < 7; i += 1) {
    const day = new Date((4 + i) * DAY_MS); // 1970-01-05 was a Monday
    names.set(i + 1, { long: long.format(day), short: short.format(day) });
  }
  return names;
}

/** Numeric year/month/day in a fixed Y/M/D order for an editable date field (ASCII digits). */
export function toEditableText(iso: string, calendar: string): string {
  const { year, month, day } = toCalendar(iso, calendar);
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

/** Parses Y/M/D text (ASCII digits; separators / - . or space) in a calendar; null if invalid. */
export function parseEditableText(text: string, calendar: string): string | null {
  const match = /^\s*(\d{1,4})\s*[/\-.\s]\s*(\d{1,2})\s*[/\-.\s]\s*(\d{1,2})\s*$/.exec(text);
  if (!match) return null;
  return fromCalendar(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    calendar,
  );
}
