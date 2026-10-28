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
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../_client/api';
import { failureMessage } from '../../../_lib/api-answer';
import { indentedSiteName } from '../../../_lib/people';
import { indentOf, isSiteName, MAX_NAME_LENGTH, ROOT_OPTION } from '../../../_lib/structure';
import type { Messages } from '../../../_i18n/messages';

// The organization chart's changes: create a unit and rename it. Moving is the shared
// MoveDialog. The API checks every value again.

export interface UnitOption {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

const CREATE_FORM = 'create-unit';

export function CreateUnitDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly units: readonly UnitOption[];
  /** The parent the dialog starts with (a unit page's "new unit below"); the top otherwise. */
  readonly parentId?: string;
  readonly trigger?: 'primary' | 'outline';
}) {
  const { t, csrfToken, units } = props;
  const router = useRouter();
  const startParent = props.parentId ?? ROOT_OPTION;
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState(startParent);
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isSiteName(name)) return setInvalid(true);
    setBusy(true);
    const answer = await callApi('POST', 'tenancy/organizations', csrfToken, {
      parentId: parent === ROOT_OPTION ? null : parent,
      name: name.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setProblem(t[failureMessage(answer)]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setParent(startParent);
          setName('');
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          props.trigger === 'outline' ? (
            <Button variant="outline" size="sm">
              <Plus aria-hidden />
              {t['org.addChild']}
            </Button>
          ) : (
            <Button>
              <Plus aria-hidden />
              {t['orgs.add']}
            </Button>
          )
        }
      />
      <DialogContent
        title={t['orgCreate.title']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['orgCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t['orgForm.parent']}>
            <Select
              value={parent}
              onValueChange={(value) => {
                if (value !== null) setParent(value);
              }}
              options={[
                { value: ROOT_OPTION, label: t['orgForm.root'] },
                ...units.map((unit) => ({
                  value: unit.id,
                  label: indentedSiteName({ ...unit, depth: indentOf(unit.depth) }),
                })),
              ]}
            />
          </Field>
          <Field label={t['orgForm.name']} error={t['error.name']} invalid={invalid}>
            <TextInput
              autoComplete="off"
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

const RENAME_FORM = 'rename-unit';

export function RenameUnitDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly unit: { readonly id: string; readonly name: string; readonly version: number };
}) {
  const { t, csrfToken, unit } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(unit.name);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isSiteName(name)) return setInvalid(true);
    setBusy(true);
    const answer = await callApi('PATCH', `tenancy/organizations/${unit.id}`, csrfToken, {
      version: unit.version,
      name: name.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setProblem(t[failureMessage(answer)]);
      // A stale version: read the current one, so the next try carries it.
      if (answer.code === 'conflict.stale') router.refresh();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(unit.name);
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Pencil aria-hidden />
            {t['org.rename']}
          </Button>
        }
      />
      <DialogContent
        title={t['orgRename.title']}
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
          <Field label={t['orgForm.name']} error={t['error.name']} invalid={invalid}>
            <TextInput
              autoComplete="off"
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
