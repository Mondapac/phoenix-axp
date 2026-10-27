'use client';
// A form rendered from a JSON Schema and a UI Schema (CLAUDE.md "Processes and forms") with
// JSON Forms and the portal renderer set. Errors stay hidden until the first submit; then an
// error summary lists them with links to the fields and takes focus (WCAG 3.3.1, 2.4.3), and
// each field shows its own message. The BFF validates again; its answer is the authority and
// its errors come back through `additionalErrors`.
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { createAjv, type JsonSchema, type Middleware, type UISchemaElement } from '@jsonforms/core';
import { JsonForms } from '@jsonforms/react';
import type { ErrorObject } from 'ajv';
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { createFormTranslator, errorField, type FormMessages } from './form-i18n.ts';
import {
  controlId,
  FormEnvironmentContext,
  portalRenderers,
  type FormEnvironment,
} from './renderers.tsx';

export interface SchemaFormProps {
  schema: JsonSchema;
  uischema: UISchemaElement;
  messages: FormMessages;
  calendar: string;
  dir: 'rtl' | 'ltr';
  today: string;
  /** Same-origin BFF route that validates and accepts the submission. */
  action: string;
}

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'failed' };

const ajv = createAjv({ allErrors: true, verbose: true });

export function SchemaForm({
  schema,
  uischema,
  messages,
  calendar,
  dir,
  today,
  action,
}: SchemaFormProps) {
  // JSON Forms keeps the live data. Feeding its debounced onChange back into the `data` prop
  // resets the form to a value 10 ms old and drops keystrokes typed meanwhile (found by this
  // spike), so the prop holds the initial value only. A middleware sees every state change
  // synchronously, so submit reads the latest data and errors, not the debounced ones.
  const [initialData] = useState<Record<string, unknown>>({});
  const live = useRef<{ data: Record<string, unknown>; errors: ErrorObject[] }>({
    data: initialData,
    errors: [],
  });
  const middleware = useCallback<Middleware>((state, action, reducer) => {
    const next = reducer(state, action);
    live.current = {
      data: (next.data ?? {}) as Record<string, unknown>,
      errors: [...(next.errors ?? [])],
    };
    return next;
  }, []);
  const [errors, setErrors] = useState<ErrorObject[]>([]);
  const [serverErrors, setServerErrors] = useState<ErrorObject[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const summaryRef = useRef<HTMLDivElement>(null);
  const { translate, errorText } = useMemo(() => createFormTranslator(messages), [messages]);
  const labels = messages.labels;
  const i18n = useMemo(
    () => ({
      locale: messages.locale,
      translate: translate as never,
      translateError: (error: ErrorObject) => errorText(error),
    }),
    [messages.locale, translate, errorText],
  );

  const env: FormEnvironment = useMemo(
    () => ({ locale: messages.locale, calendar, dir, today, labels, showErrors }),
    [messages.locale, calendar, dir, today, labels, showErrors],
  );

  const allErrors = [...errors, ...serverErrors];
  // One line per field in the summary, in form order (the first error of each field).
  const order = Object.keys((schema.properties ?? {}) as object);
  const summary = [...new Map(allErrors.map((e) => [errorField(e), e])).values()].sort(
    (a, b) => order.indexOf(errorField(a)) - order.indexOf(errorField(b)),
  );

  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    setServerErrors([]);
    setErrors(live.current.errors);
    if (live.current.errors.length > 0) return focusSummary();
    setStatus({ kind: 'sending' });
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(live.current.data),
      });
      if (response.status === 422) {
        setServerErrors(((await response.json()) as { errors: ErrorObject[] }).errors);
        setStatus({ kind: 'idle' });
        return focusSummary();
      }
      setStatus(response.ok ? { kind: 'done' } : { kind: 'failed' });
    } catch {
      setStatus({ kind: 'failed' });
    }
  }

  return (
    <DirectionProvider direction={dir}>
      <FormEnvironmentContext.Provider value={env}>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          {showErrors && summary.length > 0 && (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              aria-labelledby="error-summary-title"
              className="rounded-card border-2 border-critical bg-critical-bg p-4 text-fg"
            >
              <h2 id="error-summary-title" className="font-bold text-critical">
                {labels.errorSummaryTitle}
              </h2>
              <ul className="mt-2 list-disc ps-6">
                {summary.map((error) => (
                  <li key={errorField(error)}>
                    <a
                      href={`#${controlId(errorField(error))}`}
                      className="text-critical underline"
                    >
                      {errorText(error)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <JsonForms
            schema={schema}
            uischema={uischema}
            data={initialData}
            renderers={portalRenderers}
            ajv={ajv}
            validationMode="ValidateAndShow"
            additionalErrors={serverErrors}
            i18n={i18n}
            middleware={middleware}
            onChange={({ errors: found }) => {
              setErrors([...(found ?? [])]);
              if (status.kind === 'done') setStatus({ kind: 'idle' });
            }}
          />
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={status.kind === 'sending'}
              className="rounded-control bg-accent px-6 py-3 font-semibold text-on-accent hover:bg-accent-hover"
            >
              {status.kind === 'sending' ? labels.submitting : labels.submit}
            </button>
            <p role="status" className="font-semibold text-fg">
              {status.kind === 'done'
                ? labels.success
                : status.kind === 'failed'
                  ? labels.serverError
                  : ''}
            </p>
          </div>
        </form>
      </FormEnvironmentContext.Provider>
    </DirectionProvider>
  );
}
