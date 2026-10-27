'use client';
// A date input in the viewer's calendar (Jalali for a Persian tenant, Gregorian for another),
// with a calendar grid in a Base UI popover. The value is always an ISO date; the text box shows
// Y/M/D in the viewer's calendar and digits and accepts Persian, Arabic-Indic or ASCII digits.
// Keyboard follows the WAI-ARIA date picker dialog pattern, mirrored for right-to-left: the
// arrow keys move in the visual direction, so in RTL ArrowLeft is the next day.
import { Field } from '@base-ui/react/field';
import { Popover } from '@base-ui/react/popover';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  addDays,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  fromCalendar,
  isoToEpochDay,
  isoWeekday,
  monthName,
  parseEditableText,
  toCalendar,
  toEditableText,
  weekdayNames,
} from '../calendar/calendar.ts';
import { toAsciiDigits, toLocaleDigits } from '../text/persian.ts';
import { controlClass } from './field-shell.tsx';
import type { FormLabels } from './form-i18n.ts';

export interface CalendarDateFieldProps {
  /** ISO date, or the raw text the person typed when it is not a date (schema validation reports it). */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  locale: string;
  calendar: string;
  dir: 'rtl' | 'ltr';
  /** Today in the owning party's zone (ISO), from the server clock; the grid opens there. */
  today: string;
  labels: FormLabels['calendar'];
  id: string;
  invalid: boolean;
  required: boolean;
}

const isIso = (value: string | undefined): value is string =>
  value !== undefined && isoToEpochDay(value) !== null;

function shiftMonths(iso: string, months: number, calendar: string): string {
  const { year, month, day } = toCalendar(iso, calendar);
  const index = year * 12 + (month - 1) + months;
  const [y, m] = [Math.floor(index / 12), (index % 12) + 1];
  const last = daysInMonth(y, m, calendar);
  return fromCalendar({ year: y, month: m, day: Math.min(day, last) }, calendar) ?? iso;
}

export function CalendarDateField({
  value,
  onChange,
  locale,
  calendar,
  dir,
  today,
  labels,
  id,
  invalid,
  required,
}: CalendarDateFieldProps) {
  const ctx = useMemo(() => ({ locale, calendar }), [locale, calendar]);
  const display = (iso: string) => toLocaleDigits(toEditableText(iso, calendar), locale);
  const [text, setText] = useState(() => (isIso(value) ? display(value) : (value ?? '')));
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(isIso(value) ? value : today);
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingId = useId();
  const hintId = useId();

  // A value set from outside (the calendar, a reset) is shown in the viewer's calendar.
  useEffect(() => {
    if (isIso(value)) setText(display(value));
    // `display` is derived from calendar and locale, which are listed.
  }, [value, calendar, locale]);

  // Digits are rewritten one for one, so the caret goes back where it was.
  useLayoutEffect(() => {
    if (caret.current !== null && inputRef.current === document.activeElement) {
      inputRef.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  const commit = (raw: string) => {
    const ascii = toAsciiDigits(raw).trim();
    if (ascii === '') return onChange(undefined);
    onChange(parseEditableText(ascii, calendar) ?? ascii);
  };

  const view = toCalendar(focused, calendar);
  const firstOfMonth = fromCalendar({ year: view.year, month: view.month, day: 1 }, calendar)!;
  const monthLength = daysInMonth(view.year, view.month, calendar);
  const weekStart = firstDayOfWeek(locale);
  const lead = (isoWeekday(firstOfMonth) - weekStart + 7) % 7;
  const names = weekdayNames(locale);
  const weekdays = Array.from({ length: 7 }, (_, i) => ((weekStart - 1 + i) % 7) + 1);
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: monthLength }, (_, i) => addDays(firstOfMonth, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const heading = `${monthName(view.year, view.month, ctx)} ${toLocaleDigits(String(view.year), locale)}`;

  useEffect(() => {
    if (open) dayRefs.current.get(focused)?.focus();
  }, [focused, open]);

  const onGridKey = (event: KeyboardEvent) => {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const dow = (isoWeekday(focused) - weekStart + 7) % 7;
    const moves: Record<string, () => string> = {
      [forward]: () => addDays(focused, 1),
      [back]: () => addDays(focused, -1),
      ArrowDown: () => addDays(focused, 7),
      ArrowUp: () => addDays(focused, -7),
      Home: () => addDays(focused, -dow),
      End: () => addDays(focused, 6 - dow),
      PageDown: () => shiftMonths(focused, event.shiftKey ? 12 : 1, calendar),
      PageUp: () => shiftMonths(focused, event.shiftKey ? -12 : -1, calendar),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setFocused(move());
    }
  };

  const choose = (iso: string) => {
    onChange(iso);
    setText(display(iso));
    setOpen(false);
  };

  return (
    <div className="flex items-stretch gap-2">
      <Field.Control
        ref={inputRef}
        id={id}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        value={text}
        autoComplete="off"
        dir="ltr"
        className={`${controlClass} rtl:text-end`}
        onChange={(event) => {
          const raw = event.target.value;
          caret.current = event.target.selectionStart;
          setText(toLocaleDigits(toAsciiDigits(raw), locale));
        }}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(text);
        }}
      />
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setFocused(isIso(value) ? value : today);
          setOpen(next);
        }}
      >
        <Popover.Trigger
          className="shrink-0 rounded-control border border-line bg-surface px-3 text-fg hover:bg-subtle"
          aria-label={labels.open}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6}>
            <Popover.Popup
              aria-labelledby={headingId}
              aria-describedby={hintId}
              initialFocus={() => dayRefs.current.get(focused) ?? true}
              className="z-10 rounded-card border border-line bg-surface p-3 text-fg shadow-lg"
              dir={dir}
              lang={locale}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-control px-2 py-1 hover:bg-subtle"
                  aria-label={labels.prevMonth}
                  onClick={() => setFocused(shiftMonths(focused, -1, calendar))}
                >
                  <Chevron back />
                </button>
                <h2 id={headingId} aria-live="polite" className="font-semibold">
                  {heading}
                </h2>
                <button
                  type="button"
                  className="rounded-control px-2 py-1 hover:bg-subtle"
                  aria-label={labels.nextMonth}
                  onClick={() => setFocused(shiftMonths(focused, 1, calendar))}
                >
                  <Chevron />
                </button>
              </div>
              <table
                role="grid"
                aria-labelledby={headingId}
                onKeyDown={onGridKey}
                className="border-collapse"
              >
                <thead>
                  <tr>
                    {weekdays.map((day) => (
                      <th
                        key={day}
                        scope="col"
                        abbr={names.get(day)?.long}
                        className="size-9 text-center text-sm font-normal text-fg-muted"
                      >
                        {names.get(day)?.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, w) => (
                    <tr key={w}>
                      {week.map((iso, d) =>
                        iso === null ? (
                          <td key={d} />
                        ) : (
                          <td key={iso} role="gridcell" aria-selected={iso === value}>
                            <button
                              type="button"
                              ref={(node) => {
                                if (node) dayRefs.current.set(iso, node);
                                else dayRefs.current.delete(iso);
                              }}
                              tabIndex={iso === focused ? 0 : -1}
                              aria-label={formatDate(iso, ctx)}
                              aria-current={iso === today ? 'date' : undefined}
                              onClick={() => choose(iso)}
                              className={
                                'size-9 rounded-control text-center ' +
                                (iso === value
                                  ? 'bg-accent font-bold text-on-accent'
                                  : iso === today
                                    ? 'border border-accent hover:bg-subtle'
                                    : 'hover:bg-subtle')
                              }
                            >
                              {toLocaleDigits(String(toCalendar(iso, calendar).day), locale)}
                            </button>
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p id={hintId} className="mt-2 max-w-64 text-xs text-fg-muted">
                {labels.hint}
              </p>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** A chevron that points back or forward in the reading direction. */
function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-5 ${back ? 'rtl:-scale-x-100' : 'ltr:-scale-x-100'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
