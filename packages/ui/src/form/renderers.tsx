'use client';
// The JSON Forms renderer set for the portal: our own controls on Base UI Field instead of a
// stock set (the vanilla set has no RTL or Jalali story; the Material set brings MUI). Each
// renderer is picked by a tester, the same registry idea as the page blocks.
import {
  and,
  isDateControl,
  isEnumControl,
  isMultiLineControl,
  isStringControl,
  rankWith,
  uiTypeIs,
  type ControlProps,
  type JsonFormsRendererRegistryEntry,
  type LayoutProps,
  type OwnPropsOfEnum,
  type UISchemaElement,
} from '@jsonforms/core';
import {
  JsonFormsDispatch,
  withJsonFormsControlProps,
  withJsonFormsEnumProps,
  withJsonFormsLayoutProps,
} from '@jsonforms/react';
import { Field } from '@base-ui/react/field';
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { toEditableText } from '../calendar/calendar.ts';
import { normaliseForStorage, normaliseInput, toLocaleDigits } from '../text/persian.ts';
import { CalendarDateField } from './calendar-date-field.tsx';
import { controlClass, FieldShell } from './field-shell.tsx';
import type { FormLabels } from './form-i18n.ts';

export interface FormEnvironment {
  locale: string;
  calendar: string;
  dir: 'rtl' | 'ltr';
  today: string;
  labels: FormLabels;
  /** Whether errors are shown yet (after the first submit). */
  showErrors: boolean;
}

export const FormEnvironmentContext = createContext<FormEnvironment | null>(null);

function useEnvironment(): FormEnvironment {
  const env = useContext(FormEnvironmentContext);
  if (!env) throw new Error('schema form renderers need a FormEnvironmentContext');
  return env;
}

/** The DOM id of a control, shared with the error summary's links. */
export const controlId = (path: string) => `field-${path.replace(/\./g, '-')}`;

type Mode = 'identifier' | 'text';
const modeOf = (uischema: UISchemaElement): Mode =>
  uischema.options?.normalise === 'identifier' ? 'identifier' : 'text';

function Shell(props: ControlProps & { children: ReactNode }) {
  const env = useEnvironment();
  return (
    <FieldShell
      name={props.path}
      label={props.label}
      description={props.description}
      error={env.showErrors && props.errors ? props.errors : undefined}
      required={props.required}
      requiredMark={env.labels.requiredMark}
    >
      {props.children}
    </FieldShell>
  );
}

function TextControl(props: ControlProps) {
  const env = useEnvironment();
  const mode = modeOf(props.uischema);
  const multi = Boolean(props.uischema.options?.multi);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const value = typeof props.data === 'string' ? props.data : '';
  // Identifiers are stored with ASCII digits and shown in the locale's digits.
  const shown = mode === 'identifier' ? toLocaleDigits(value, env.locale) : value;

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current === document.activeElement) {
      ref.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [shown]);

  return (
    <Shell {...props}>
      <Field.Control
        ref={ref}
        id={controlId(props.path)}
        render={multi ? <textarea rows={4} /> : undefined}
        value={shown}
        aria-required={props.required || undefined}
        aria-invalid={(env.showErrors && Boolean(props.errors)) || undefined}
        inputMode={props.uischema.options?.inputMode as 'numeric' | undefined}
        autoComplete={props.uischema.options?.autoComplete as string | undefined}
        dir={mode === 'identifier' ? 'ltr' : undefined}
        // LTR digits, aligned like the other fields: end of an LTR box is the right edge in RTL.
        className={`${controlClass} ${mode === 'identifier' ? 'rtl:text-end' : ''}`}
        onChange={(event: { target: HTMLInputElement | HTMLTextAreaElement }) => {
          caret.current = event.target.selectionStart;
          const next = normaliseInput(event.target.value, mode);
          props.handleChange(props.path, next === '' ? undefined : next);
        }}
        onBlur={() => {
          const stored = normaliseForStorage(value, mode);
          if (stored !== value) props.handleChange(props.path, stored === '' ? undefined : stored);
        }}
      />
    </Shell>
  );
}

function DateControl(props: ControlProps) {
  const env = useEnvironment();
  const example = toLocaleDigits(toEditableText(env.today, env.calendar), env.locale);
  return (
    <Shell
      {...props}
      description={[props.description, env.labels.dateFormatHint.replace('{example}', example)]
        .filter(Boolean)
        .join(' ')}
    >
      <CalendarDateField
        value={typeof props.data === 'string' ? props.data : undefined}
        onChange={(next) => props.handleChange(props.path, next)}
        locale={env.locale}
        calendar={env.calendar}
        dir={env.dir}
        today={env.today}
        labels={env.labels.calendar}
        id={controlId(props.path)}
        invalid={env.showErrors && Boolean(props.errors)}
        required={props.required ?? false}
      />
    </Shell>
  );
}

function SelectControl(props: ControlProps & OwnPropsOfEnum) {
  const env = useEnvironment();
  return (
    <Shell {...props}>
      <Field.Control
        id={controlId(props.path)}
        render={<select />}
        value={typeof props.data === 'string' ? props.data : ''}
        aria-required={props.required || undefined}
        aria-invalid={(env.showErrors && Boolean(props.errors)) || undefined}
        className={controlClass}
        onChange={(event) => props.handleChange(props.path, event.target.value || undefined)}
      >
        <option value="">{'—'}</option>
        {props.options?.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </Field.Control>
    </Shell>
  );
}

function VerticalLayout({ uischema, schema, path, enabled, renderers, cells }: LayoutProps) {
  const elements = (uischema as UISchemaElement & { elements: UISchemaElement[] }).elements;
  return (
    <div className="flex flex-col gap-5">
      {elements.map((child, index) => (
        <JsonFormsDispatch
          key={index}
          uischema={child}
          schema={schema}
          path={path}
          enabled={enabled}
          renderers={renderers}
          cells={cells}
        />
      ))}
    </div>
  );
}

function GroupLayout(props: LayoutProps) {
  const label = props.label;
  return (
    <fieldset className="rounded-card border border-line bg-surface p-5">
      {label && <legend className="px-2 text-lg font-bold text-fg">{label}</legend>}
      <VerticalLayout {...props} />
    </fieldset>
  );
}

export const portalRenderers: JsonFormsRendererRegistryEntry[] = [
  {
    tester: rankWith(1, uiTypeIs('VerticalLayout')),
    renderer: withJsonFormsLayoutProps(VerticalLayout),
  },
  { tester: rankWith(1, uiTypeIs('Group')), renderer: withJsonFormsLayoutProps(GroupLayout) },
  { tester: rankWith(2, isStringControl), renderer: withJsonFormsControlProps(TextControl) },
  { tester: rankWith(3, isMultiLineControl), renderer: withJsonFormsControlProps(TextControl) },
  { tester: rankWith(4, isEnumControl), renderer: withJsonFormsEnumProps(SelectControl) },
  {
    tester: rankWith(5, and(isStringControl, isDateControl)),
    renderer: withJsonFormsControlProps(DateControl),
  },
];
