'use client';
import Link from 'next/link';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardContent,
  Checkbox,
  Field,
  formatNumber,
  Select,
  Switch,
  TextInput,
} from '@phoenix/ui';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '../../../../_client/api';
import { failureMessage } from '../../../../_lib/api-answer';
import {
  checkDrafts,
  draftOf,
  FIELD_TYPES,
  hasLimit,
  MAX_FIELDS,
  MAX_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_OPTIONS,
  moveDraft,
  newDraft,
  PORTAL_MODES,
  revisionBody,
  TEXT_LIMITS,
  type DraftProblem,
  type FieldDraft,
  type FieldType,
  type FieldView,
  type PortalMode,
} from '../../../../_lib/objects';
import { fill, type Messages } from '../../../../_i18n/messages';

// The field list of the next revision, edited in place: label, API key, type, rules, portal
// access, options of a choice and the length of a text. The checks only point at the input the
// API would refuse; it checks every rule again.

const fieldAnchor = (index: number) => `field-${index}`;

function OptionsEditor(props: {
  readonly t: Messages;
  readonly index: number;
  readonly draft: FieldDraft;
  readonly invalid: boolean;
  readonly onChange: (options: FieldDraft['options']) => void;
}) {
  const { t, draft, index } = props;
  const set = (at: number, part: 'key' | 'label', value: string) =>
    props.onChange(draft.options.map((o, i) => (i === at ? { ...o, [part]: value } : o)));
  return (
    <fieldset className="min-w-0 space-y-3 sm:col-span-2">
      <legend className="mb-1.5 text-sm font-medium text-fg">{t['fieldsEdit.options']}</legend>
      {draft.options.map((option, at) => (
        <div key={at} className="flex min-w-0 items-end gap-2">
          <Field label={t['fieldsEdit.optionLabel']} className="flex-1" invalid={props.invalid}>
            <TextInput
              autoComplete="off"
              normalise="text"
              maxLength={MAX_NAME_LENGTH}
              value={option.label}
              onChange={(event) => set(at, 'label', event.currentTarget.value)}
            />
          </Field>
          <Field label={t['fieldsEdit.optionKey']} className="flex-1" invalid={props.invalid}>
            <TextInput
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_KEY_LENGTH}
              value={option.key}
              onChange={(event) => set(at, 'key', event.currentTarget.value)}
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t['fieldsEdit.removeOption']} ${at + 1}`}
            onClick={() => props.onChange(draft.options.filter((_, i) => i !== at))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      {props.invalid ? (
        <p className="text-xs text-critical" id={`${fieldAnchor(index)}-options-error`}>
          {t['error.options']}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={draft.options.length >= MAX_OPTIONS}
        onClick={() => props.onChange([...draft.options, { key: '', label: '' }])}
      >
        <Plus aria-hidden />
        {t['fieldsEdit.addOption']}
      </Button>
    </fieldset>
  );
}

function FieldCard(props: {
  readonly t: Messages;
  readonly index: number;
  readonly count: number;
  readonly draft: FieldDraft;
  readonly problem: DraftProblem | null;
  readonly canLower: boolean;
  readonly locale: string;
  readonly onChange: (draft: FieldDraft) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const { t, index, draft, problem } = props;
  const invalid = (part: DraftProblem['part']) => problem?.index === index && problem.part === part;
  const set = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) =>
    props.onChange({ ...draft, [key]: value });
  // A kept field keeps its type; lowering its sensitivity needs its own key.
  const kept = draft.id !== undefined;
  const sensitiveLocked = draft.wasSensitive && draft.sensitive && !props.canLower;
  const title =
    draft.label.trim() === ''
      ? fill(t['fieldsEdit.field'], { n: formatNumber(index + 1, props.locale) })
      : draft.label;

  return (
    <Card id={fieldAnchor(index)} className="scroll-mt-20">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold text-fg">
          <bdi>{title}</bdi>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${t['fieldsEdit.moveUp']}: ${title}`}
            disabled={index === 0}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${t['fieldsEdit.moveDown']}: ${title}`}
            disabled={index === props.count - 1}
            onClick={() => props.onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-critical!"
            aria-label={`${t['fieldsEdit.remove']}: ${title}`}
            onClick={props.onRemove}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
        <Field label={t['fieldsEdit.label']} error={t['error.name']} invalid={invalid('label')}>
          <TextInput
            autoComplete="off"
            normalise="text"
            maxLength={MAX_NAME_LENGTH}
            value={draft.label}
            onChange={(event) => set('label', event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t['fieldsEdit.key']}
          description={t['fieldsEdit.keyHint']}
          error={t['error.fieldKey']}
          invalid={invalid('key')}
        >
          <TextInput
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_KEY_LENGTH}
            value={draft.key}
            onChange={(event) => set('key', event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t['fieldsEdit.type']}
          description={kept ? t['fieldsEdit.typeFixed'] : undefined}
        >
          <Select
            value={draft.type}
            disabled={kept}
            onValueChange={(value) => {
              if (value !== null) props.onChange({ ...draft, type: value as FieldType });
            }}
            options={FIELD_TYPES.map((type) => ({ value: type, label: t[`fieldType.${type}`] }))}
          />
        </Field>
        <Field label={t['fieldsEdit.portal']} description={t['fieldsEdit.portalHint']}>
          <Select
            value={draft.portal}
            onValueChange={(value) => {
              if (value !== null) set('portal', value as PortalMode);
            }}
            options={PORTAL_MODES.map((mode) => ({ value: mode, label: t[`portal.${mode}`] }))}
          />
        </Field>
        {hasLimit(draft.type) ? (
          <Field
            label={t['fieldsEdit.maxLength']}
            description={fill(t['fieldsEdit.maxLengthHint'], {
              n: formatNumber(TEXT_LIMITS[draft.type], props.locale),
            })}
            error={fill(t['error.maxLength'], {
              n: formatNumber(TEXT_LIMITS[draft.type], props.locale),
            })}
            invalid={invalid('maxLength')}
          >
            <TextInput
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={draft.maxLength}
              onChange={(event) => set('maxLength', event.currentTarget.value)}
            />
          </Field>
        ) : null}
        {draft.type === 'choice' ? (
          <OptionsEditor
            t={t}
            index={index}
            draft={draft}
            invalid={invalid('options')}
            onChange={(options) => set('options', options)}
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
          <Checkbox
            label={t['fieldsEdit.required']}
            checked={draft.required}
            onCheckedChange={(checked) => set('required', checked)}
          />
          <Switch
            label={t['fieldsEdit.sensitive']}
            checked={draft.sensitive}
            disabled={sensitiveLocked}
            onCheckedChange={(checked) => set('sensitive', checked)}
          />
          <p className="text-xs text-fg-muted">
            {sensitiveLocked ? t['fieldsEdit.sensitiveLocked'] : t['fieldsEdit.sensitiveHint']}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function FieldsEditor(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly definitionId: string;
  /** The newest revision's fields; empty for a definition without a revision. */
  readonly fields: readonly FieldView[];
  readonly canLower: boolean;
  readonly locale: string;
}) {
  const { t, csrfToken, definitionId } = props;
  const router = useRouter();
  const [drafts, setDrafts] = useState<FieldDraft[]>(() =>
    props.fields.length === 0 ? [newDraft()] : props.fields.map(draftOf),
  );
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (next: FieldDraft[]) => {
    setDrafts(next);
    setProblem(null);
  };

  async function save() {
    setFailure(null);
    const found = checkDrafts(drafts);
    if (found !== null) {
      setProblem(found);
      if (found.index < 0) setFailure(t['fieldsEdit.empty']);
      else document.getElementById(fieldAnchor(found.index))?.scrollIntoView({ block: 'start' });
      return;
    }
    setBusy(true);
    const answer = await callApi(
      'POST',
      `objects/definitions/${definitionId}/revisions`,
      csrfToken,
      revisionBody(drafts),
    );
    setBusy(false);
    if (answer.ok) {
      router.push(`/objects/${definitionId}`);
      router.refresh();
      return;
    }
    setFailure(
      answer.code === 'objects.value.invalid' ? t['error.fields'] : t[failureMessage(answer)],
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {drafts.map((draft, index) => (
        <FieldCard
          // The id of a kept field, else the place: a new field has nothing else to key on.
          key={draft.id ?? `new-${index}`}
          t={t}
          index={index}
          count={drafts.length}
          draft={draft}
          problem={problem}
          canLower={props.canLower}
          locale={props.locale}
          onChange={(next) => change(drafts.map((d, i) => (i === index ? next : d)))}
          onMove={(by) => change(moveDraft(drafts, index, by))}
          onRemove={() => change(drafts.filter((_, i) => i !== index))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={drafts.length >= MAX_FIELDS}
        onClick={() => change([...drafts, newDraft()])}
      >
        <Plus aria-hidden />
        {t['fieldsEdit.add']}
      </Button>
      {failure === null ? null : <Alert tone="critical">{failure}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href={`/objects/${definitionId}`}
          className={`${buttonClasses('outline')} no-underline`}
        >
          {t['common.cancel']}
        </Link>
        <Button type="submit" disabled={busy}>
          {busy ? t['common.saving'] : t['fieldsEdit.save']}
        </Button>
      </div>
    </form>
  );
}
