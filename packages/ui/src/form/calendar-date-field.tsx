'use client';
import { normaliseInput } from '@phoenix/shared-kernel/persian-text';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { DirectionalIcon } from '../components/bidi';
import { buttonClasses } from '../components/button-classes';
import { cn } from '../lib/cn';
import {
  addDays,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  fromCalendar,
  isoWeekday,
  monthName,
  parseEditableText,
  toCalendar,
  toEditableText,
  weekdayNames,
  type CalendarDate,
} from '../locale/calendar';
import { directionOf, formatNumber, toLocaleDigits } from '../locale/locale';

// A date in the viewer's calendar (ADR-0008 decision 3): the text box takes year/month/day in
// that calendar and any digit script; the grid in a popover follows the WAI-ARIA date picker
// keys, with the arrows mirrored in a right-to-left page. The value is always an ISO date.

export interface CalendarDateFieldTexts {
  /** The accessible name of the button that opens the grid. */
  readonly open: string;
  readonly previousMonth: string;
  readonly nextMonth: string;
}

export interface CalendarDateFieldProps {
  readonly id?: string;
  /** ISO date (YYYY-MM-DD), or undefined. */
  readonly value: string | undefined;
  /** Called with an ISO date, or undefined when the text is cleared or not a date. */
  readonly onChange: (value: string | undefined) => void;
  readonly locale: string;
  readonly calendar: string;
  /** The ISO date the grid opens on when there is no value. */
  readonly today: string;
  readonly texts: CalendarDateFieldTexts;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onBlur?: () => void;
}

const CONTROL =
  'h-10 w-full min-w-0 rounded-control border border-line-strong bg-surface ps-3 pe-11 text-sm text-fg ' +
  'placeholder:text-fg-muted hover:border-fg-muted focus-visible:border-focus disabled:cursor-not-allowed disabled:opacity-50';

const displayText = (iso: string | undefined, calendar: string, locale: string) =>
  iso === undefined ? '' : toLocaleDigits(toEditableText(iso, calendar), locale);

export function CalendarDateField(props: CalendarDateFieldProps) {
  const { value, locale, calendar, texts } = props;
  const [text, setText] = useState(() => displayText(value, calendar, locale));
  const [shown, setShown] = useState(value);
  const [open, setOpen] = useState(false);
  // The value changed from outside (another field, a reset): show it.
  if (value !== shown) {
    setShown(value);
    if (parseEditableText(normaliseInput(text, 'identifier'), calendar) !== (value ?? null)) {
      setText(displayText(value, calendar, locale));
    }
  }
  const placeholder = toLocaleDigits(toEditableText(props.today, calendar), locale);

  return (
    // Left to right as a whole, so the calendar button and the text's padding sit on one side.
    <div className="relative" dir="ltr">
      <input
        id={props.id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        autoComplete="off"
        className={cn(CONTROL, 'text-start', props.invalid && 'border-critical')}
        value={text}
        placeholder={placeholder}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        onBlur={props.onBlur}
        onChange={(event) => {
          setText(event.currentTarget.value);
          const ascii = normaliseInput(event.currentTarget.value, 'identifier');
          const iso =
            ascii.trim() === '' ? undefined : (parseEditableText(ascii, calendar) ?? undefined);
          setShown(iso);
          props.onChange(iso);
        }}
      />
      <BasePopover.Root open={open} onOpenChange={setOpen}>
        <BasePopover.Trigger
          disabled={props.disabled}
          aria-label={texts.open}
          className={cn(buttonClasses('ghost', 'icon-sm'), 'absolute inset-y-1 end-1 my-auto')}
        >
          <CalendarDays aria-hidden />
        </BasePopover.Trigger>
        <BasePopover.Portal>
          <BasePopover.Positioner sideOffset={8} align="end" className="z-50">
            <BasePopover.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-raised p-3 text-sm text-fg shadow-popup outline-none">
              <MonthGrid
                selected={value}
                start={value ?? props.today}
                today={props.today}
                locale={locale}
                calendar={calendar}
                texts={texts}
                onPick={(iso) => {
                  setText(displayText(iso, calendar, locale));
                  setShown(iso);
                  props.onChange(iso);
                  setOpen(false);
                }}
              />
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </div>
  );
}

function shiftMonth({ year, month }: CalendarDate, by: number): CalendarDate {
  // Twelve months a year in the calendars we serve (gregory, persian).
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1, day: 1 };
}

function MonthGrid(props: {
  readonly selected: string | undefined;
  readonly start: string;
  readonly today: string;
  readonly locale: string;
  readonly calendar: string;
  readonly texts: CalendarDateFieldTexts;
  readonly onPick: (iso: string) => void;
}) {
  const { locale, calendar } = props;
  const [focused, setFocused] = useState(props.start);
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const shown = toCalendar(focused, calendar);
  const first = fromCalendar({ year: shown.year, month: shown.month, day: 1 }, calendar) ?? focused;
  const length = daysInMonth(shown.year, shown.month, calendar);
  const weekStart = firstDayOfWeek(locale);
  const lead = (isoWeekday(first) - weekStart + 7) % 7;
  const names = weekdayNames(locale);
  const order = Array.from({ length: 7 }, (_, i) => ((weekStart - 1 + i) % 7) + 1);
  const rtl = directionOf(locale) === 'rtl';

  const move = (iso: string) => {
    setFocused(iso);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`)?.focus(),
    );
  };
  const goMonth = (by: number) => {
    const target = shiftMonth(shown, by);
    const day = Math.min(shown.day, daysInMonth(target.year, target.month, calendar));
    const iso = fromCalendar({ ...target, day }, calendar);
    if (iso !== null) setFocused(iso);
  };
  const onKey = (event: KeyboardEvent) => {
    const forward = rtl ? -1 : 1;
    const steps: Record<string, number> = {
      ArrowRight: forward,
      ArrowLeft: -forward,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(addDays(focused, step));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const day = event.key === 'Home' ? 1 : length;
      move(fromCalendar({ ...shown, day }, calendar) ?? focused);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const target = shiftMonth(shown, event.key === 'PageUp' ? -1 : 1);
      const day = Math.min(shown.day, daysInMonth(target.year, target.month, calendar));
      move(fromCalendar({ ...target, day }, calendar) ?? focused);
    }
  };

  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => addDays(first, i)),
  ];
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={buttonClasses('ghost', 'icon-sm')}
          aria-label={props.texts.previousMonth}
          onClick={() => goMonth(-1)}
        >
          <DirectionalIcon>
            <ChevronLeft aria-hidden />
          </DirectionalIcon>
        </button>
        <p id={titleId} className="font-semibold" aria-live="polite">
          {monthName(shown.year, shown.month, { locale, calendar })}{' '}
          {formatNumber(shown.year, locale).replace(/[٬,]/g, '')}
        </p>
        <button
          type="button"
          className={buttonClasses('ghost', 'icon-sm')}
          aria-label={props.texts.nextMonth}
          onClick={() => goMonth(1)}
        >
          <DirectionalIcon>
            <ChevronRight aria-hidden />
          </DirectionalIcon>
        </button>
      </div>
      <div role="grid" aria-labelledby={titleId} ref={grid} onKeyDown={onKey}>
        <div role="row" className="grid grid-cols-7 text-center text-xs text-fg-muted">
          {order.map((weekday) => (
            <span
              key={weekday}
              role="columnheader"
              aria-label={names.get(weekday)?.long}
              className="py-1"
            >
              {names.get(weekday)?.short}
            </span>
          ))}
        </div>
        {weeks.map((week, row) => (
          <div key={row} role="row" className="grid grid-cols-7 gap-0.5">
            {week.map((iso, cell) =>
              iso === null ? (
                <span key={`empty-${cell}`} role="gridcell" />
              ) : (
                <span key={iso} role="gridcell" aria-selected={iso === props.selected}>
                  <button
                    type="button"
                    data-iso={iso}
                    tabIndex={iso === focused ? 0 : -1}
                    aria-label={formatDate(iso, { locale, calendar })}
                    aria-current={iso === props.today ? 'date' : undefined}
                    onClick={() => props.onPick(iso)}
                    className={cn(
                      'flex h-9 w-full cursor-pointer items-center justify-center rounded-control text-sm hover:bg-subtle',
                      iso === props.today && 'font-semibold text-accent-fg',
                      iso === props.selected && 'bg-accent text-on-accent hover:bg-accent-hover',
                    )}
                  >
                    {formatNumber(toCalendar(iso, calendar).day, locale)}
                  </button>
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
