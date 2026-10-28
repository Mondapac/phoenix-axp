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
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../_client/api';
import { failureMessage } from '../../../_lib/api-answer';
import { isRoleKey, scopeLabel, type PermissionGroup } from '../../../_lib/people';
import type { Messages } from '../../../_i18n/messages';
import { PermissionPicker } from './permission-picker';

// Creating a custom role: its key, its level and the keys it confers, then its page.

const CREATE_FORM = 'create-role';

type Scope = 'tenant' | 'site';

export function CreateRoleDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly groups: Readonly<Record<Scope, readonly PermissionGroup[]>>;
  readonly held: readonly string[];
}) {
  const { t, csrfToken, groups, held } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [scope, setScope] = useState<Scope>('tenant');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [invalid, setInvalid] = useState<'key' | 'permissionKeys' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isRoleKey(key)) return setInvalid('key');
    if (chosen.size === 0) return setInvalid('permissionKeys');
    setBusy(true);
    const answer = await callApi<{ id: string }>('POST', 'identity/roles', csrfToken, {
      key: key.trim().toLowerCase(),
      scope,
      permissionKeys: [...chosen],
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.push(`/people/roles/${answer.body.id}`);
      return;
    }
    if (answer.code === 'identity.value.invalid') setProblem(t['error.invalid']);
    else setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setKey('');
          setScope('tenant');
          setChosen(new Set());
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus aria-hidden />
            {t['roles.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['roleCreate.title']}
        closeLabel={t['common.close']}
        className="sm:max-w-2xl"
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['roleCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-5" onSubmit={(e) => void submit(e)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t['roleCreate.key']}
              description={t['roleCreate.keyHint']}
              error={t['error.invalid']}
              invalid={invalid === 'key'}
            >
              <TextInput
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                value={key}
                onChange={(event) => {
                  setKey(event.currentTarget.value);
                  setInvalid(null);
                }}
                required
              />
            </Field>
            <Field label={t['roleCreate.scope']} description={t['roleCreate.scopeHint']}>
              <Select
                value={scope}
                onValueChange={(value) => {
                  if (value !== 'tenant' && value !== 'site') return;
                  setScope(value);
                  // A site role may confer only site keys: drop what no longer fits.
                  const fits = new Set(groups[value].flatMap((g) => g.keys.map((k) => k.key)));
                  setChosen(new Set([...chosen].filter((k) => fits.has(k))));
                }}
                options={(['tenant', 'site'] as const).map((s) => ({
                  value: s,
                  label: scopeLabel(t, s),
                }))}
              />
            </Field>
          </div>
          <PermissionPicker
            t={t}
            groups={groups[scope]}
            held={held}
            chosen={chosen}
            invalid={invalid === 'permissionKeys'}
            onChange={(next) => {
              setChosen(next);
              setInvalid(null);
            }}
          />
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
