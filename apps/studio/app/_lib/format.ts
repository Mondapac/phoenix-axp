// Dates on the studio screens: an API instant read in the tenant's locale, calendar and time zone
// (ADR-0008: Jalali for a Persian tenant, the locale's digits).

export interface DateContext {
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
}

/** An ISO-8601 instant as a date for reading, or the text itself when it is not one. */
export function formatInstantDate(instant: string, { locale, calendar, timeZone }: DateContext) {
  const epochMs = Date.parse(instant);
  if (Number.isNaN(epochMs)) return instant;
  return new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(epochMs);
}

/** An ISO-8601 instant as a date and time for reading (a deadline), in the tenant's zone. */
export function formatInstantDateTime(
  instant: string,
  { locale, calendar, timeZone }: DateContext,
) {
  const epochMs = Date.parse(instant);
  if (Number.isNaN(epochMs)) return instant;
  return new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs);
}
