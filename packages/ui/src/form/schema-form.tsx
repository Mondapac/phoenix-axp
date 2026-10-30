'use client';
import type {
  Category,
  ControlProps,
  JsonFormsRendererRegistryEntry,
  LayoutProps,
  UISchemaElement,
} from '@jsonforms/core';
import {
  and,
  isBooleanControl,
  isDateControl,
  isEnumControl,
  isIntegerControl,
  isNumberControl,
  isStringControl,
  optionIs,
  rankWith,
  uiTypeIs,
} from '@jsonforms/core';
import {
  JsonForms,
  JsonFormsDispatch,
  useJsonForms,
  withJsonFormsControlProps,
  withJsonFormsLayoutProps,
} from '@jsonforms/react';
import { normaliseInput } from '@phoenix/shared-kernel/persian-text';
import { Check } from 'lucide-react';
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/button';
import { Checkbox, Select } from '../components/choice';
import { TextArea, TextInput } from '../components/field';
import { cn } from '../lib/cn';
import { formatNumber, toLocaleDigits } from '../locale/locale';
import { CalendarDateField, type CalendarDateFieldTexts } from './calendar-date-field';
import { stepOfErrors } from './form-layout';
import {
  choiceLabel,
  descriptionOf,
  errorText,
  labelOf,
  type FormError,
  type FormErrorTexts,
} from './form-text';

// A form from its JSON Schema and UI Schema (ADR-0007; phase 2 review: JSON Forms rendered on
// packages/ui). The renderers below are the only ones registered: an element they do not know
// renders nothing (fail closed), and no document can inject markup. Rows put their controls on
// a 12-column grid (`options.span`, stacked on a phone), groups are sections, a Categorization
// is a stepper. The same component renders the studio's preview and the portal's form.

export interface SchemaFormTexts {
  readonly errors: FormErrorTexts;
  readonly date: CalendarDateFieldTexts;
  readonly required: string;
  readonly choose: string;
  readonly next: string;
  readonly back: string;
  /** `{current}` and `{total}`. */
  readonly stepOf: string;
}

export interface SchemaFormProps {
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly uiSchema: Readonly<Record<string, unknown>>;
  /**
   * The starting answers. The form owns its answers after it mounts and reports them through
   * `onChange`; feeding them back would let a late change overwrite a newer keystroke. To start
   * over, remount the form with a new `key`.
   */
  readonly data: Readonly<Record<string, unknown>>;
  readonly onChange: (data: Record<string, unknown>, valid: boolean) => void;
  readonly locale: string;
  readonly calendar: string;
  /** The ISO date the date picker opens on when a date is empty. */
  readonly today: string;
  readonly texts: SchemaFormTexts;
  /** Show every error now (after a submit attempt); otherwise only touched fields show theirs. */
  readonly showErrors: boolean;
  readonly readonly?: boolean;
  /** The last step's actions (the submit button); shown under the form or the last step. */
  readonly footer?: ReactNode;
}

interface FormEnv {
  readonly locale: string;
  readonly calendar: string;
  readonly today: string;
  readonly texts: SchemaFormTexts;
  readonly showErrors: boolean;
  readonly touched: ReadonlySet<string>;
  readonly touch: (path: string) => void;
  readonly showAll: () => void;
  readonly footer: ReactNode;
}

const Env = createContext<FormEnv | null>(null);

function useEnv(): FormEnv {
  const env = useContext(Env);
  if (env === null) throw new Error('A form renderer outside SchemaForm');
  return env;
}

export function SchemaForm(props: SchemaFormProps) {
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAllNow, setShowAll] = useState(false);
  const [initialData] = useState(props.data);
  const { texts, locale } = props;
  const env = useMemo<FormEnv>(
    () => ({
      locale,
      calendar: props.calendar,
      today: props.today,
      texts,
      showErrors: props.showErrors || showAllNow,
      touched,
      touch: (path) =>
        setTouched((before) => (before.has(path) ? before : new Set([...before, path]))),
      showAll: () => setShowAll(true),
      footer: props.footer,
    }),
    [
      locale,
      props.calendar,
      props.today,
      texts,
      props.showErrors,
      showAllNow,
      touched,
      props.footer,
    ],
  );
  const i18n = useMemo(
    () => ({
      locale,
      translateError: (error: FormError) =>
        errorText(error, texts.errors, (limit) => formatNumber(limit, locale)),
    }),
    [locale, texts.errors],
  );
  const isStepper = props.uiSchema.type === 'Categorization';
  return (
    <Env.Provider value={env}>
      <JsonForms
        schema={props.jsonSchema}
        uischema={props.uiSchema as unknown as UISchemaElement}
        data={initialData}
        renderers={RENDERERS}
        i18n={i18n}
        readonly={props.readonly ?? false}
        validationMode="ValidateAndShow"
        onChange={({ data, errors }) =>
          props.onChange((data ?? {}) as Record<string, unknown>, (errors ?? []).length === 0)
        }
      />
      {isStepper || props.footer === undefined ? null : (
        <div className="mt-6 flex flex-wrap justify-end gap-2">{props.footer}</div>
      )}
    </Env.Provider>
  );
}

// Controls -----------------------------------------------------------------------------------

function ControlFrame(props: {
  readonly control: ControlProps;
  readonly children: (ids: {
    inputId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  readonly asGroup?: boolean;
}) {
  const env = useEnv();
  const { control } = props;
  // React's id, not JSON Forms' counter: the same on the server and in the browser.
  const base = useId();
  if (!control.visible) return null;
  const label = labelOf(control.uischema, control.schema, env.locale);
  const description = descriptionOf(control.uischema, control.schema, env.locale);
  const shown = env.showErrors || env.touched.has(control.path);
  const error = shown && control.errors !== '' ? control.errors : '';
  const descriptionId = description === undefined ? undefined : `${base}-description`;
  const errorId = error === '' ? undefined : `${base}-error`;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-path={control.path}>
      {props.asGroup ? null : (
        <label htmlFor={`${base}-input`} className="text-sm font-medium text-fg">
          <bdi>{label}</bdi>
          {control.required ? (
            <span className="text-critical" aria-hidden>
              {' *'}
            </span>
          ) : null}
          {control.required ? <span className="sr-only">{` (${env.texts.required})`}</span> : null}
        </label>
      )}
      {props.children({ inputId: `${base}-input`, describedBy, invalid: error !== '' })}
      {description === undefined ? null : (
        <p id={descriptionId} className="text-xs text-fg-muted">
          {description}
        </p>
      )}
      {error === '' ? null : (
        <p id={errorId} className="text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

function TextControl(control: ControlProps) {
  const env = useEnv();
  const multi = control.uischema.options?.multi === true;
  const { format, pattern } = control.schema as { format?: string; pattern?: string };
  // An address or a patterned answer (a national code) takes ASCII digits whatever is typed.
  const ascii = format === 'email' || pattern !== undefined;
  const value = typeof control.data === 'string' ? control.data : '';
  const set = (text: string) => control.handleChange(control.path, text === '' ? undefined : text);
  return (
    <ControlFrame control={control}>
      {({ inputId, describedBy, invalid }) =>
        multi ? (
          <TextArea
            id={inputId}
            value={value}
            disabled={!control.enabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={control.required || undefined}
            onBlur={() => env.touch(control.path)}
            onChange={(event) =>
              set(normaliseInput(event.currentTarget.value, ascii ? 'identifier' : 'text'))
            }
          />
        ) : (
          <TextInput
            id={inputId}
            value={value}
            normalise={ascii ? 'identifier' : 'text'}
            {...(format === 'email' ? { type: 'email', dir: 'ltr', autoComplete: 'email' } : {})}
            disabled={!control.enabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={control.required || undefined}
            className={invalid ? 'border-critical' : undefined}
            onBlur={() => env.touch(control.path)}
            onChange={(event) => set(event.currentTarget.value)}
          />
        )
      }
    </ControlFrame>
  );
}

/** A number typed in any digit script; kept as text while it is not a number yet. */
function NumberControl(control: ControlProps) {
  const env = useEnv();
  const integer = (control.schema as { type?: string }).type === 'integer';
  const fromData =
    typeof control.data === 'number' ? toLocaleDigits(String(control.data), env.locale) : '';
  const [text, setText] = useState(fromData);
  const parsed = Number(normaliseInput(text, 'identifier'));
  if (typeof control.data === 'number' && parsed !== control.data && text.trim() !== '') {
    // Changed from outside the field.
    setText(fromData);
  }
  return (
    <ControlFrame control={control}>
      {({ inputId, describedBy, invalid }) => (
        <TextInput
          id={inputId}
          value={text}
          inputMode={integer ? 'numeric' : 'decimal'}
          dir="ltr"
          disabled={!control.enabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={control.required || undefined}
          className={cn('text-start', invalid && 'border-critical')}
          onBlur={() => env.touch(control.path)}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            const ascii = normaliseInput(next, 'identifier').trim().replace('٫', '.');
            if (ascii === '') return control.handleChange(control.path, undefined);
            const number = Number(ascii);
            // Not a number yet: hand the text on, so the schema's type check reports it.
            control.handleChange(control.path, Number.isFinite(number) ? number : ascii);
          }}
        />
      )}
    </ControlFrame>
  );
}

function BooleanControl(control: ControlProps) {
  const env = useEnv();
  if (!control.visible) return null;
  const label = labelOf(control.uischema, control.schema, env.locale);
  const description = descriptionOf(control.uischema, control.schema, env.locale);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-1" data-path={control.path}>
      <Checkbox
        label={<bdi>{label}</bdi>}
        checked={control.data === true}
        disabled={!control.enabled}
        onCheckedChange={(checked) => control.handleChange(control.path, checked)}
      />
      {description === undefined ? null : <p className="text-xs text-fg-muted">{description}</p>}
    </div>
  );
}

function EnumControl(control: ControlProps) {
  const env = useEnv();
  const values = ((control.schema as { enum?: unknown[] }).enum ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
  const options = values.map((value) => ({
    value,
    label: choiceLabel(control.uischema, value, env.locale),
  }));
  return (
    <ControlFrame control={control}>
      {({ inputId }) => (
        <Select
          id={inputId}
          aria-label={labelOf(control.uischema, control.schema, env.locale)}
          value={typeof control.data === 'string' ? control.data : null}
          placeholder={env.texts.choose}
          disabled={!control.enabled}
          options={options}
          onValueChange={(value) => {
            env.touch(control.path);
            control.handleChange(control.path, value ?? undefined);
          }}
        />
      )}
    </ControlFrame>
  );
}

function DateControl(control: ControlProps) {
  const env = useEnv();
  return (
    <ControlFrame control={control}>
      {({ inputId, describedBy, invalid }) => (
        <CalendarDateField
          id={inputId}
          value={typeof control.data === 'string' ? control.data : undefined}
          onChange={(iso) => control.handleChange(control.path, iso)}
          locale={env.locale}
          calendar={env.calendar}
          today={env.today}
          texts={env.texts.date}
          invalid={invalid}
          disabled={!control.enabled}
          describedBy={describedBy}
          onBlur={() => env.touch(control.path)}
        />
      )}
    </ControlFrame>
  );
}

// Layouts ------------------------------------------------------------------------------------

type Elements = readonly UISchemaElement[];
const elementsOf = (uischema: UISchemaElement): Elements =>
  (uischema as { elements?: Elements }).elements ?? [];

function Children({
  layout,
  elements,
}: {
  readonly layout: LayoutProps;
  readonly elements: Elements;
}) {
  return elements.map((element, index) => (
    <JsonFormsDispatch
      key={`${layout.path}-${index}`}
      uischema={element}
      schema={layout.schema}
      path={layout.path}
      enabled={layout.enabled}
      renderers={layout.renderers}
      cells={layout.cells}
    />
  ));
}

function VerticalLayout(layout: LayoutProps) {
  if (!layout.visible) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Children layout={layout} elements={elementsOf(layout.uischema)} />
    </div>
  );
}

/** Column spans on the 12-column grid of a row, from a phone's width up (static class names). */
const SPAN: Readonly<Record<number, string>> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6',
  7: 'sm:col-span-7',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  10: 'sm:col-span-10',
  11: 'sm:col-span-11',
  12: 'sm:col-span-12',
};

/** The span of each element of a row: its `options.span`, the rest shared evenly. */
export function rowSpans(elements: Elements): number[] {
  const asked = elements.map((element) => {
    const span = (element as { options?: { span?: unknown } }).options?.span;
    return typeof span === 'number' && Number.isInteger(span) && span >= 1 && span <= 12
      ? span
      : null;
  });
  const free = asked.filter((span) => span === null).length;
  const used = asked.reduce<number>((sum, span) => sum + (span ?? 0), 0);
  const share = free === 0 ? 0 : Math.max(1, Math.floor((12 - Math.min(used, 11)) / free));
  return asked.map((span) => span ?? share);
}

function HorizontalLayout(layout: LayoutProps) {
  if (!layout.visible) return null;
  const elements = elementsOf(layout.uischema);
  const spans = rowSpans(elements);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-12">
      {elements.map((element, index) => (
        <div key={`${layout.path}-${index}`} className={cn('min-w-0', SPAN[spans[index] ?? 12])}>
          <JsonFormsDispatch
            uischema={element}
            schema={layout.schema}
            path={layout.path}
            enabled={layout.enabled}
            renderers={layout.renderers}
            cells={layout.cells}
          />
        </div>
      ))}
    </div>
  );
}

function GroupLayout(layout: LayoutProps) {
  const env = useEnv();
  if (!layout.visible) return null;
  const label = labelOf(layout.uischema, undefined, env.locale);
  const description = descriptionOf(layout.uischema, undefined, env.locale);
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-card border border-line p-4">
      {label === '' ? null : (
        <legend className="px-1 text-sm font-semibold text-fg">
          <bdi>{label}</bdi>
        </legend>
      )}
      {description === undefined ? null : (
        <p className="-mt-2 text-xs text-fg-muted">{description}</p>
      )}
      <Children layout={layout} elements={elementsOf(layout.uischema)} />
    </fieldset>
  );
}

function StepperLayout(layout: LayoutProps) {
  const env = useEnv();
  const { core } = useJsonForms();
  const [step, setStep] = useState(0);
  if (!layout.visible) return null;
  const categories = elementsOf(layout.uischema).filter(
    (element): element is Category => element.type === 'Category',
  );
  const total = categories.length;
  const current = categories[Math.min(step, total - 1)];
  if (current === undefined) return null;
  const at = Math.min(step, total - 1);
  const next = () => {
    if (stepOfErrors(core?.errors ?? [], current)) {
      env.showAll();
      return;
    }
    setStep(at + 1);
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ol
        className="flex min-w-0 flex-wrap items-center gap-2"
        aria-label={env.texts.stepOf
          .replace('{current}', formatNumber(at + 1, env.locale))
          .replace('{total}', formatNumber(total, env.locale))}
      >
        {categories.map((category, index) => (
          <li
            key={index}
            aria-current={index === at ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-pill border px-3 py-1 text-xs',
              index === at
                ? 'border-accent bg-accent-subtle font-semibold text-accent-fg'
                : 'border-line text-fg-muted',
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-subtle text-fg">
              {index < at ? (
                <Check className="size-3" aria-hidden />
              ) : (
                formatNumber(index + 1, env.locale)
              )}
            </span>
            <span className="truncate">
              <bdi>{labelOf(category, undefined, env.locale)}</bdi>
            </span>
          </li>
        ))}
      </ol>
      <JsonFormsDispatch
        key={at}
        uischema={{ type: 'VerticalLayout', elements: current.elements }}
        schema={layout.schema}
        path={layout.path}
        enabled={layout.enabled}
        renderers={layout.renderers}
        cells={layout.cells}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {at > 0 ? (
          <Button variant="outline" onClick={() => setStep(at - 1)}>
            {env.texts.back}
          </Button>
        ) : (
          <span />
        )}
        {at < total - 1 ? (
          <Button onClick={next}>{env.texts.next}</Button>
        ) : (
          <div className="flex flex-wrap gap-2">{env.footer}</div>
        )}
      </div>
    </div>
  );
}

function LabelElement(layout: LayoutProps) {
  const env = useEnv();
  if (!layout.visible) return null;
  return <p className="text-sm text-fg-muted">{labelOf(layout.uischema, undefined, env.locale)}</p>;
}

const RENDERERS: JsonFormsRendererRegistryEntry[] = [
  { tester: rankWith(1, isStringControl), renderer: withJsonFormsControlProps(TextControl) },
  { tester: rankWith(2, isIntegerControl), renderer: withJsonFormsControlProps(NumberControl) },
  { tester: rankWith(2, isNumberControl), renderer: withJsonFormsControlProps(NumberControl) },
  { tester: rankWith(2, isBooleanControl), renderer: withJsonFormsControlProps(BooleanControl) },
  { tester: rankWith(3, isEnumControl), renderer: withJsonFormsControlProps(EnumControl) },
  { tester: rankWith(4, isDateControl), renderer: withJsonFormsControlProps(DateControl) },
  {
    tester: rankWith(4, and(isStringControl, optionIs('format', 'date'))),
    renderer: withJsonFormsControlProps(DateControl),
  },
  {
    tester: rankWith(1, uiTypeIs('VerticalLayout')),
    renderer: withJsonFormsLayoutProps(VerticalLayout),
  },
  {
    tester: rankWith(1, uiTypeIs('HorizontalLayout')),
    renderer: withJsonFormsLayoutProps(HorizontalLayout),
  },
  { tester: rankWith(1, uiTypeIs('Group')), renderer: withJsonFormsLayoutProps(GroupLayout) },
  { tester: rankWith(1, uiTypeIs('Label')), renderer: withJsonFormsLayoutProps(LabelElement) },
  {
    tester: rankWith(1, (uischema) => uischema.type === 'Categorization'),
    renderer: withJsonFormsLayoutProps(StepperLayout),
  },
];
