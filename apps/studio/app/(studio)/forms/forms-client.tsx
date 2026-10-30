'use client';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  SchemaForm,
  Select,
  Switch,
  TextInput,
  todayIn,
} from '@phoenix/ui';
import { Archive, Eye, Pencil, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../_client/api';
import { failureMessage } from '../../_lib/api-answer';
import {
  AUDIENCES,
  isFormKey,
  isFormName,
  isRetentionDays,
  MAX_FORM_NAME_LENGTH,
  MAX_KEY_LENGTH,
  schemaFormTexts,
  type Audience,
  type FormPolicy,
  type Retention,
  type RevisionView,
} from '../../_lib/forms';
import { indentedSiteName } from '../../_lib/people';
import { fill, type Messages } from '../../_i18n/messages';
import { ConfirmDialog } from '../_components/confirm-dialog';

// The form definition's changes (slice 2.4 API): create a form, rename it, change its
// submission policy and retention, publish a revision, retire it, and preview a revision with
// the portal's renderer. Each form points at the field the API would refuse before sending.

export interface RoleOption {
  readonly id: string;
  readonly label: string;
}

interface SettingsValue {
  readonly audience: Audience;
  readonly roleIds: readonly string[];
  readonly allowOnBehalf: boolean;
  readonly retentionKind: 'forever' | 'fixed';
  readonly days: string;
}

const settingsOf = (policy: FormPolicy, retention: Retention): SettingsValue => ({
  audience: policy.audience,
  roleIds: policy.roleIds,
  allowOnBehalf: policy.allowOnBehalf,
  retentionKind: retention.kind,
  days: retention.kind === 'fixed' ? String(retention.days) : '',
});

const DEFAULT_SETTINGS: SettingsValue = {
  audience: 'anyone',
  roleIds: [],
  allowOnBehalf: false,
  retentionKind: 'forever',
  days: '',
};

/** The body members `policy` and `retention`, or null when the days are not valid. */
function settingsBody(value: SettingsValue) {
  const days = Number(value.days);
  if (value.retentionKind === 'fixed' && !isRetentionDays(days)) return null;
  return {
    policy: {
      audience: value.audience,
      roleIds: value.audience === 'staff-roles' ? value.roleIds : [],
      allowOnBehalf: value.allowOnBehalf,
    },
    retention: value.retentionKind === 'fixed' ? { kind: 'fixed', days } : { kind: 'forever' },
  };
}

function SettingsFields(props: {
  readonly t: Messages;
  readonly value: SettingsValue;
  readonly onChange: (value: SettingsValue) => void;
  readonly roles: readonly RoleOption[] | null;
  readonly daysInvalid: boolean;
}) {
  const { t, value, onChange } = props;
  return (
    <>
      <Field label={t['formSettings.audience']}>
        <Select
          value={value.audience}
          onValueChange={(audience) => {
            if (audience !== null) onChange({ ...value, audience: audience as Audience });
          }}
          options={AUDIENCES.map((audience) => ({
            value: audience,
            label: t[`audience.${audience}`],
          }))}
        />
      </Field>
      {value.audience === 'staff-roles' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">{t['formSettings.roles']}</legend>
          {props.roles === null || props.roles.length === 0 ? (
            <p className="text-sm text-fg-muted">{t['formSettings.rolesNone']}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {props.roles.map((role) => (
                <Checkbox
                  key={role.id}
                  label={<bdi>{role.label}</bdi>}
                  checked={value.roleIds.includes(role.id)}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      roleIds: checked
                        ? [...value.roleIds, role.id]
                        : value.roleIds.filter((id) => id !== role.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </fieldset>
      ) : null}
      <div className="space-y-1">
        <Switch
          label={t['formSettings.onBehalf']}
          checked={value.allowOnBehalf}
          onCheckedChange={(allowOnBehalf) => onChange({ ...value, allowOnBehalf })}
        />
        <p className="text-xs text-fg-muted">{t['formSettings.onBehalfHint']}</p>
      </div>
      <Field label={t['formSettings.retention']}>
        <Select
          value={value.retentionKind}
          onValueChange={(kind) => {
            if (kind === 'forever' || kind === 'fixed') onChange({ ...value, retentionKind: kind });
          }}
          options={[
            { value: 'forever', label: t['retention.forever'] },
            { value: 'fixed', label: t['retention.fixed'] },
          ]}
        />
      </Field>
      {value.retentionKind === 'fixed' ? (
        <Field
          label={t['formSettings.days']}
          description={t['formSettings.daysHint']}
          invalid={props.daysInvalid}
          error={t['error.retentionDays']}
        >
          <TextInput
            value={value.days}
            inputMode="numeric"
            dir="ltr"
            normalise="identifier"
            className="text-start"
            onChange={(event) => onChange({ ...value, days: event.currentTarget.value })}
          />
        </Field>
      ) : null}
    </>
  );
}

const CREATE_FORM = 'create-form';

export function CreateFormDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly sites: readonly { id: string; name: string; depth: number }[];
  readonly currentSite: string | null;
  readonly roles: readonly RoleOption[] | null;
}) {
  const { t, csrfToken, sites } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [invalid, setInvalid] = useState<'site' | 'name' | 'key' | 'days' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (site === null) return setInvalid('site');
    if (!isFormName(name)) return setInvalid('name');
    if (!isFormKey(key)) return setInvalid('key');
    const body = settingsBody(settings);
    if (body === null) return setInvalid('days');
    setInvalid(null);
    setBusy(true);
    const answer = await callApi<{ id: string }>('POST', 'forms/forms', csrfToken, {
      siteId: site,
      key,
      name: name.trim(),
      ...body,
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      // The new form's next step is its fields.
      router.push(`/forms/${answer.body.id}/design`);
      return;
    }
    if (answer.code === 'forms.form.key-taken') setInvalid('key');
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSite(
            sites.some((s) => s.id === props.currentSite)
              ? props.currentSite
              : (sites[0]?.id ?? null),
          );
          setName('');
          setKey('');
          setSettings(DEFAULT_SETTINGS);
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus aria-hidden />
            {t['forms.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['formCreate.title']}
        description={t['formCreate.description']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['formCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field
            label={t['formCreate.site']}
            invalid={invalid === 'site'}
            error={t['common.required']}
          >
            <Select
              value={site}
              placeholder={t['formCreate.sitePlaceholder']}
              onValueChange={setSite}
              options={sites.map((s) => ({ value: s.id, label: indentedSiteName(s) }))}
            />
          </Field>
          <Field
            label={t['formCreate.name']}
            invalid={invalid === 'name'}
            error={t['error.formName']}
          >
            <TextInput
              value={name}
              maxLength={MAX_FORM_NAME_LENGTH}
              normalise="text"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <Field
            label={t['formCreate.key']}
            description={t['formCreate.keyHint']}
            invalid={invalid === 'key'}
            error={t['error.formKey']}
          >
            <TextInput
              value={key}
              dir="ltr"
              className="text-start"
              maxLength={MAX_KEY_LENGTH}
              autoComplete="off"
              onChange={(event) => setKey(event.currentTarget.value.toLowerCase())}
            />
          </Field>
          <SettingsFields
            t={t}
            value={settings}
            onChange={setSettings}
            roles={props.roles}
            daysInvalid={invalid === 'days'}
          />
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SETTINGS_FORM = 'form-settings';

/**
 * Edits the policy and retention: a draft through PATCH (design key, with the name), any status
 * through PUT settings (publish key).
 */
export function SettingsDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly form: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly version: number;
    readonly policy: FormPolicy;
    readonly retention: Retention;
  };
  readonly roles: readonly RoleOption[] | null;
  /** True: the member holds the publish key (PUT settings); false: a draft's PATCH. */
  readonly asPublisher: boolean;
}) {
  const { t, form } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(() => settingsOf(form.policy, form.retention));
  const [daysInvalid, setDaysInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const body = settingsBody(settings);
    setDaysInvalid(body === null);
    if (body === null) return;
    setBusy(true);
    const answer = props.asPublisher
      ? await callApi('PUT', `forms/forms/${form.id}/settings`, props.csrfToken, {
          version: form.version,
          ...body,
        })
      : await callApi('PATCH', `forms/forms/${form.id}`, props.csrfToken, {
          version: form.version,
          name: form.name,
          ...body,
        });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    if (answer.code === 'conflict.stale') router.refresh();
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSettings(settingsOf(form.policy, form.retention));
          setDaysInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Pencil aria-hidden />
            {t['formSettings.edit']}
          </Button>
        }
      />
      <DialogContent
        title={t['formSettings.editTitle']}
        description={form.status === 'draft' ? undefined : t['formSettings.publisherNote']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={SETTINGS_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['common.save']}
            </Button>
          </>
        }
      >
        <form id={SETTINGS_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <SettingsFields
            t={t}
            value={settings}
            onChange={setSettings}
            roles={props.roles}
            daysInvalid={daysInvalid}
          />
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const RENAME_FORM = 'rename-form';

/** Renames a draft (PATCH carries the policy and retention unchanged). */
export function RenameFormDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly form: {
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly policy: FormPolicy;
    readonly retention: Retention;
  };
}) {
  const { t, form } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(form.name);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    setInvalid(!isFormName(name));
    if (!isFormName(name)) return;
    setBusy(true);
    const answer = await callApi('PATCH', `forms/forms/${form.id}`, props.csrfToken, {
      version: form.version,
      name: name.trim(),
      policy: form.policy,
      retention: form.retention,
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    if (answer.code === 'conflict.stale') router.refresh();
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(form.name);
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Pencil aria-hidden />
            {t['form.rename']}
          </Button>
        }
      />
      <DialogContent
        title={t['form.renameTitle']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={RENAME_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['common.save']}
            </Button>
          </>
        }
      >
        <form id={RENAME_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['formCreate.name']} invalid={invalid} error={t['error.formName']}>
            <TextInput
              value={name}
              maxLength={MAX_FORM_NAME_LENGTH}
              normalise="text"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PublishRevisionButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly revision: { readonly id: string; readonly number: number };
  readonly numberText: string;
}) {
  const { t } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <Send aria-hidden />
              {t['revisions.publish']}
            </Button>
          }
        />
      }
      title={t['revisions.publish.title']}
      description={fill(t['revisions.publish.description'], { number: props.numberText })}
      confirmLabel={t['revisions.publish.confirm']}
      onConfirm={() =>
        callApi('POST', `forms/forms/${props.formId}/publish`, props.csrfToken, {
          version: props.formVersion,
          revisionId: props.revision.id,
        })
      }
      onDone={() => router.refresh()}
    />
  );
}

export function RetireFormButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly form: { readonly id: string; readonly name: string; readonly version: number };
}) {
  const { t, form } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="outline">
              <Archive aria-hidden />
              {t['form.retire']}
            </Button>
          }
        />
      }
      title={t['form.retire.title']}
      description={fill(t['form.retire.description'], { name: form.name })}
      confirmLabel={t['form.retire.confirm']}
      onConfirm={() =>
        callApi('POST', `forms/forms/${form.id}/retire`, props.csrfToken, { version: form.version })
      }
      onDone={() => router.refresh()}
    />
  );
}

/** A revision rendered as the portal will show it; nothing is sent. */
export function PreviewRevisionButton(props: {
  readonly t: Messages;
  readonly revision: Pick<RevisionView, 'jsonSchema' | 'uiSchema'>;
  readonly title: string;
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
}) {
  const { t } = props;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Eye aria-hidden />
            {t['revisions.preview']}
          </Button>
        }
      />
      <DialogContent title={props.title} closeLabel={t['common.close']} className="max-w-3xl">
        <PreviewForm
          t={t}
          jsonSchema={props.revision.jsonSchema}
          uiSchema={props.revision.uiSchema}
          locale={props.locale}
          calendar={props.calendar}
          timeZone={props.timeZone}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The live form of a preview: validates on "send" and says so; never calls the API. */
export function PreviewForm(props: {
  readonly t: Messages;
  readonly jsonSchema: Record<string, unknown>;
  readonly uiSchema: Record<string, unknown>;
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
}) {
  const { t } = props;
  const [data, setData] = useState<Record<string, unknown>>({});
  const [valid, setValid] = useState(false);
  const [tried, setTried] = useState(false);
  const texts = useStableTexts(t);
  const [today] = useState(() => todayIn(props.timeZone));
  return (
    <div className="space-y-4">
      <SchemaForm
        jsonSchema={props.jsonSchema}
        uiSchema={props.uiSchema}
        data={data}
        onChange={(next, isValid) => {
          setData(next);
          setValid(isValid);
        }}
        locale={props.locale}
        calendar={props.calendar}
        today={today}
        texts={texts}
        showErrors={tried}
        footer={
          <Button type="button" onClick={() => setTried(true)}>
            {t['formText.submitPreview']}
          </Button>
        }
      />
      {tried && valid ? <Alert tone="success">{t['formText.previewValid']}</Alert> : null}
    </div>
  );
}

const textsCache = new WeakMap<Messages, ReturnType<typeof schemaFormTexts>>();
/** The same texts object for the same messages, so the form does not re-render for nothing. */
function useStableTexts(t: Messages) {
  let texts = textsCache.get(t);
  if (texts === undefined) {
    texts = schemaFormTexts(t);
    textsCache.set(t, texts);
  }
  return texts;
}
