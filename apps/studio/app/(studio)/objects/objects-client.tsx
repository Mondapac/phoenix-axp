'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Select,
  TextInput,
} from '@phoenix/ui';
import { Archive, Pencil, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../_client/api';
import { failureMessage } from '../../_lib/api-answer';
import { isKey, isName, MAX_KEY_LENGTH, MAX_NAME_LENGTH } from '../../_lib/objects';
import { indentedSiteName } from '../../_lib/people';
import { indentOf } from '../../_lib/structure';
import { fill, type Messages } from '../../_i18n/messages';
import { ConfirmDialog } from '../_components/confirm-dialog';

// The changes of an Object definition: create, rename, publish a revision and retire. Each form
// points at the field the API would refuse before sending; the API checks everything again.

interface SiteOption {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

const CREATE_FORM = 'create-object';

export function CreateObjectDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  /** The member's sites in tree order; the API refuses one without the design key there. */
  readonly sites: readonly SiteOption[];
}) {
  const { t, csrfToken, sites } = props;
  const router = useRouter();
  const firstSite = sites[0]?.id ?? '';
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(firstSite);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [invalid, setInvalid] = useState<'name' | 'key' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isName(name)) return setInvalid('name');
    if (!isKey(key)) return setInvalid('key');
    setBusy(true);
    const answer = await callApi<{ id: string }>('POST', 'objects/definitions', csrfToken, {
      siteId: site,
      key,
      name: name.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      // A new definition's next step is its fields.
      router.push(`/objects/${answer.body.id}/fields`);
      return;
    }
    if (
      answer.code === 'objects.value.invalid' &&
      (answer.field === 'key' || answer.field === 'name')
    ) {
      return setInvalid(answer.field);
    }
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSite(firstSite);
          setName('');
          setKey('');
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus aria-hidden />
            {t['objects.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['objectCreate.title']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['objectCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['objects.col.site']} description={t['objectCreate.siteHint']}>
            <Select
              value={site}
              onValueChange={(value) => {
                if (value !== null) setSite(value);
              }}
              options={sites.map((s) => ({
                value: s.id,
                label: indentedSiteName({ ...s, depth: indentOf(s.depth) }),
              }))}
            />
          </Field>
          <Field
            label={t['objectCreate.name']}
            error={t['error.name']}
            invalid={invalid === 'name'}
          >
            <TextInput
              autoComplete="off"
              normalise="text"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setInvalid(null);
              }}
              required
            />
          </Field>
          <Field
            label={t['objects.col.key']}
            description={t['objectCreate.keyHint']}
            error={t['error.key']}
            invalid={invalid === 'key'}
          >
            <TextInput
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_KEY_LENGTH}
              value={key}
              onChange={(event) => {
                setKey(event.currentTarget.value);
                setInvalid(null);
              }}
              required
            />
          </Field>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const RENAME_FORM = 'rename-object';

export function RenameObjectDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly definition: { readonly id: string; readonly name: string; readonly version: number };
}) {
  const { t, csrfToken, definition } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(definition.name);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isName(name)) return setInvalid(true);
    setBusy(true);
    const answer = await callApi('PATCH', `objects/definitions/${definition.id}`, csrfToken, {
      version: definition.version,
      name: name.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    setProblem(t[failureMessage(answer)]);
    // A stale version: read the current one, so the next try carries it.
    if (answer.code === 'conflict.stale') router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(definition.name);
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Pencil aria-hidden />
            {t['object.rename']}
          </Button>
        }
      />
      <DialogContent
        title={t['objectRename.title']}
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
          <Field label={t['objectCreate.name']} error={t['error.name']} invalid={invalid}>
            <TextInput
              autoComplete="off"
              normalise="text"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setInvalid(false);
              }}
              required
            />
          </Field>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Publishes one revision: new records and every later change use it. */
export function PublishRevisionButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly definition: { readonly id: string; readonly version: number };
  readonly revision: { readonly id: string; readonly number: string };
  readonly size?: 'sm';
}) {
  const { t, csrfToken, definition, revision } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      confirmVariant="primary"
      trigger={
        <DialogTrigger
          render={
            <Button variant={props.size === 'sm' ? 'ghost' : 'primary'} size={props.size ?? 'md'}>
              <Send aria-hidden />
              {t['object.publish']}
            </Button>
          }
        />
      }
      title={fill(t['publish.title'], { n: revision.number })}
      description={t['publish.description']}
      confirmLabel={t['publish.confirm']}
      onConfirm={() =>
        callApi('POST', `objects/definitions/${definition.id}/publish`, csrfToken, {
          version: definition.version,
          revisionId: revision.id,
        })
      }
      onDone={() => router.refresh()}
      onStale={() => router.refresh()}
    />
  );
}

export function RetireObjectButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly definition: { readonly id: string; readonly name: string; readonly version: number };
}) {
  const { t, csrfToken, definition } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="outline">
              <Archive aria-hidden />
              {t['object.retire']}
            </Button>
          }
        />
      }
      title={fill(t['retire.title'], { name: `\u2068${definition.name}\u2069` })}
      description={t['retire.description']}
      confirmLabel={t['retire.confirm']}
      onConfirm={() =>
        callApi('POST', `objects/definitions/${definition.id}/retire`, csrfToken, {
          version: definition.version,
        })
      }
      onDone={() => router.refresh()}
      onStale={() => router.refresh()}
    />
  );
}
