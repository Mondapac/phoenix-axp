'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  DialogTrigger,
  Field,
  Select,
  TextArea,
  TextInput,
} from '@phoenix/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '../../../../_client/api';
import { failureMessage } from '../../../../_lib/api-answer';
import {
  changesOf,
  displayValue,
  inputText,
  recordsPath,
  TEXT_LIMITS,
  valueOf,
  type DescribedField,
  type StoredValue,
  type ValueContext,
} from '../../../../_lib/objects';
import { fill, type Messages } from '../../../../_i18n/messages';
import { ConfirmDialog } from '../../../_components/confirm-dialog';

// A record's form (ADR-0024): on create, the fields the member may set at the site; on edit,
// the fields it may read or change there. A field it may only read shows its value as text and
// is never sent; a hidden field is not in the description and never appears. The API applies
// the same field rules again.

const NOT_SET = '\u0000';

/** An example of the date text the inputs take, in the tenant's calendar. */
const exampleOf = (field: DescribedField, ctx: ValueContext) =>
  inputText(field, field.type === 'date' ? '2026-10-30' : '2026-10-30T06:30:00Z', {
    ...ctx,
    timeZone: 'UTC',
  });

function ValueInput(props: {
  readonly t: Messages;
  readonly field: DescribedField;
  readonly text: string;
  readonly onChange: (text: string) => void;
}) {
  const { t, field, text } = props;
  const notSet = { value: NOT_SET, label: t['recordForm.notSet'] };
  switch (field.type) {
    case 'boolean':
    case 'choice': {
      const options =
        field.type === 'boolean'
          ? [
              { value: 'true', label: t['common.yes'] },
              { value: 'false', label: t['common.no'] },
            ]
          : (field.options ?? []).map((option) => ({ value: option.key, label: option.label }));
      return (
        <Select
          value={text === '' ? NOT_SET : text}
          onValueChange={(value) => {
            if (value !== null) props.onChange(value === NOT_SET ? '' : value);
          }}
          options={field.required ? options : [notSet, ...options]}
          placeholder={t['recordForm.notSet']}
        />
      );
    }
    case 'long-text':
      return (
        <TextArea
          value={text}
          maxLength={field.maxLength ?? TEXT_LIMITS['long-text']}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      );
    case 'integer':
    case 'decimal':
    case 'date':
    case 'date-time':
      return (
        <TextInput
          dir="ltr"
          inputMode={field.type === 'integer' || field.type === 'decimal' ? 'decimal' : 'text'}
          autoComplete="off"
          spellCheck={false}
          className="text-start"
          value={text}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      );
    default:
      return (
        <TextInput
          autoComplete="off"
          normalise="text"
          maxLength={field.maxLength ?? TEXT_LIMITS.text}
          value={text}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      );
  }
}

const hintOf = (t: Messages, field: DescribedField, ctx: ValueContext) => {
  if (field.type === 'date')
    return fill(t['recordForm.dateHint'], { example: exampleOf(field, ctx) });
  if (field.type === 'date-time')
    return fill(t['recordForm.dateTimeHint'], { example: exampleOf(field, ctx) });
  return undefined;
};

export function RecordForm(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly objectKey: string;
  readonly ctx: ValueContext;
  /** The described fields at the record's site (or the definition's, on create). */
  readonly fields: readonly DescribedField[];
  /** The record being edited; absent on create. */
  readonly record?: {
    readonly id: string;
    readonly version: number;
    readonly values: Readonly<Record<string, StoredValue>>;
  };
  readonly canDelete?: boolean;
  /** The site a new record is created at; the definition's own when absent. */
  readonly siteId?: string;
}) {
  const { t, csrfToken, objectKey, ctx, record } = props;
  const router = useRouter();
  const creating = record === undefined;
  const editable = (field: DescribedField) => (creating ? field.create : field.update);
  const shown = props.fields.filter((field) =>
    creating ? field.create : field.read || field.update,
  );
  const start = () =>
    Object.fromEntries(
      shown.map((field) => [field.key, inputText(field, record?.values[field.key], ctx)]),
    );
  const [texts, setTexts] = useState<Record<string, string>>(start);
  const [invalid, setInvalid] = useState<{ key: string; required: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = { yes: t['common.yes'], no: t['common.no'] };
  const anyEditable = shown.some(editable);
  const base = recordsPath(objectKey);

  async function submit() {
    setProblem(null);
    setNotice(null);
    const sent: Record<string, StoredValue | null> = {};
    for (const field of shown.filter(editable)) {
      const value = valueOf(field, texts[field.key] ?? '', ctx);
      if (value === undefined) return setInvalid({ key: field.key, required: false });
      if (value === null && field.required) return setInvalid({ key: field.key, required: true });
      sent[field.key] = value;
    }
    let values: Record<string, StoredValue | null>;
    if (creating) {
      values = Object.fromEntries(Object.entries(sent).filter(([, value]) => value !== null));
    } else {
      values = changesOf(shown, record.values, sent);
      if (Object.keys(values).length === 0) return setNotice(t['record.noChanges']);
    }
    setBusy(true);
    const answer = creating
      ? await callApi<{ id: string }>('POST', `objects/o/${objectKey}/records`, csrfToken, {
          ...(props.siteId === undefined ? {} : { siteId: props.siteId }),
          values,
        })
      : await callApi('PATCH', `objects/o/${objectKey}/records/${record.id}`, csrfToken, {
          version: record.version,
          values,
        });
    setBusy(false);
    if (answer.ok) {
      if (creating) {
        router.push(`${base}/${(answer.body as { id: string }).id}`);
      } else {
        setNotice(t['record.saved']);
        router.refresh();
      }
      return;
    }
    if (answer.code === 'objects.record.invalid' && answer.field !== undefined) {
      if (shown.some((field) => field.key === answer.field)) {
        return setInvalid({ key: answer.field, required: false });
      }
    }
    setProblem(t[failureMessage(answer)]);
    // A stale version: read the current one, so the next try carries it.
    if (answer.code === 'conflict.stale') router.refresh();
  }

  if (shown.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-fg-muted">
            {creating ? t['recordForm.noCreate'] : t['record.noFields']}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CardContent className="grid gap-x-6 gap-y-5 pt-5 md:grid-cols-2">
          {shown.map((field) => {
            const wide = field.type === 'long-text';
            if (!editable(field)) {
              const value = displayValue(field, record?.values[field.key], ctx, words);
              return (
                <div
                  key={field.key}
                  className={`min-w-0 space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">
                      <bdi>{field.label}</bdi>
                    </span>
                    <Badge className="shrink-0">{t['record.readOnly']}</Badge>
                  </div>
                  <p className="min-h-10 whitespace-pre-wrap break-words rounded-control bg-subtle px-3 py-2 text-sm text-fg">
                    {value === '' ? (
                      <span className="text-fg-muted">{t['record.noValue']}</span>
                    ) : (
                      <bdi>{value}</bdi>
                    )}
                  </p>
                </div>
              );
            }
            const isInvalid = invalid?.key === field.key;
            return (
              <Field
                key={field.key}
                className={wide ? 'md:col-span-2' : undefined}
                label={
                  field.required ? (
                    <>
                      <bdi>{field.label}</bdi>{' '}
                      <span className="text-critical" aria-hidden>
                        *
                      </span>
                      <span className="sr-only">{t['field.required']}</span>
                    </>
                  ) : (
                    <bdi>{field.label}</bdi>
                  )
                }
                description={hintOf(t, field, ctx)}
                error={invalid?.required ? t['error.required'] : t['error.value']}
                invalid={isInvalid}
              >
                <ValueInput
                  t={t}
                  field={field}
                  text={texts[field.key] ?? ''}
                  onChange={(text) => {
                    setTexts((current) => ({ ...current, [field.key]: text }));
                    if (isInvalid) setInvalid(null);
                  }}
                />
              </Field>
            );
          })}
        </CardContent>
        {problem === null && notice === null ? null : (
          <div className="px-5 pb-4">
            {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
            {notice === null ? null : <Alert tone="info">{notice}</Alert>}
          </div>
        )}
        <CardFooter className="justify-between">
          {props.canDelete && record !== undefined ? (
            <ConfirmDialog
              t={t}
              trigger={
                <DialogTrigger
                  render={
                    <Button type="button" variant="ghost" className="text-critical!">
                      <Trash2 aria-hidden />
                      {t['record.delete']}
                    </Button>
                  }
                />
              }
              title={t['recordDelete.title']}
              description={t['recordDelete.description']}
              confirmLabel={t['recordDelete.confirm']}
              onConfirm={() =>
                callApi(
                  'DELETE',
                  `objects/o/${objectKey}/records/${record.id}?version=${record.version}`,
                  csrfToken,
                )
              }
              onDone={() => {
                router.push(base);
                router.refresh();
              }}
            />
          ) : (
            <span />
          )}
          {anyEditable ? (
            <Button type="submit" disabled={busy}>
              {busy ? t['common.saving'] : creating ? t['record.create'] : t['record.save']}
            </Button>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}

/** The site a new record goes to: changing it reloads the fields the member may set there. */
export function RecordSitePicker(props: {
  readonly label: string;
  readonly value: string;
  readonly sites: readonly { readonly id: string; readonly name: string; readonly depth: number }[];
}) {
  const router = useRouter();
  return (
    <Field label={props.label} className="max-w-md">
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) router.replace(`?site=${value}`);
        }}
        options={props.sites.map((site, _, all) => ({
          value: site.id,
          label: `${'\u00a0'.repeat(3 * Math.min(site.depth - (all[0]?.depth ?? 0), 8))}${site.name}`,
        }))}
      />
    </Field>
  );
}
