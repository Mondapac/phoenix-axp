'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  TextInput,
} from '@phoenix/ui';
import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../_client/api';
import { failureMessage } from '../../../_lib/api-answer';
import { isUsername } from '../../../_lib/people';
import { fill, type Messages } from '../../../_i18n/messages';
import { ConfirmDialog } from '../../_components/confirm-dialog';

// The changes on the users screen. Each one calls the API through the BFF, then reloads the
// server-rendered list; the API decides, the screen only reports its answer.

const CREATE_FORM = 'create-account';

export function CreateAccountDialog({
  t,
  csrfToken,
}: {
  readonly t: Messages;
  readonly csrfToken: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isUsername(username)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    const answer = await callApi<{ id: string }>('POST', 'identity/staff-accounts', csrfToken, {
      username: username.trim(),
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.push(`/people/accounts/${answer.body.id}`);
      return;
    }
    if (answer.code === 'identity.value.invalid') setInvalid(true);
    else setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setUsername('');
          setInvalid(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <UserPlus aria-hidden />
            {t['accounts.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['accounts.create.title']}
        description={t['accounts.create.description']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['accounts.create.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field
            label={t['accounts.create.username']}
            description={t['accounts.create.usernameHint']}
            error={t['error.invalid']}
            invalid={invalid}
          >
            <TextInput
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              normalise="identifier"
              maxLength={255}
              value={username}
              onChange={(event) => {
                setUsername(event.currentTarget.value);
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

export function DisableAccountButton({
  t,
  csrfToken,
  account,
}: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly account: { readonly id: string; readonly username: string; readonly version: number };
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" className="text-critical!">
              {t['accounts.disable']}
            </Button>
          }
        />
      }
      title={t['accounts.disable.title']}
      description={fill(t['accounts.disable.description'], { name: account.username })}
      confirmLabel={t['accounts.disable.confirm']}
      onConfirm={() =>
        callApi('POST', `identity/staff-accounts/${account.id}/disable`, csrfToken, {
          version: account.version,
        })
      }
      onDone={() => router.refresh()}
    />
  );
}
