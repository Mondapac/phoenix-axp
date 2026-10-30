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
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../_client/api';
import { failureMessage } from '../../_lib/api-answer';
import { isProcessKey, starterModel } from '../../_lib/process';
import type { Messages } from '../../_i18n/messages';

// A new process: its key (the BPMN process id, fixed for life: the engine's definition key) and
// its name. Its first draft is a start event, one user task and an end event, saved at once so
// the modeler opens on it.

const CREATE_FORM = 'create-process';

export function CreateProcessDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly taken: readonly string[];
}) {
  const { t, csrfToken } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState<'key' | 'taken' | 'name' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (!isProcessKey(key)) return setInvalid('key');
    if (props.taken.includes(key)) return setInvalid('taken');
    if (name.trim().length === 0) return setInvalid('name');
    setBusy(true);
    const answer = await callApi('PUT', `process/definitions/${key}/draft`, csrfToken, {
      bpmnXml: starterModel(key, name.trim(), t['processes.starterTask']),
      version: 0,
    });
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      router.push(`/processes/${key}`);
      return;
    }
    if (answer.code === 'conflict.stale') return setInvalid('taken');
    setProblem(t[failureMessage(answer)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setKey('');
          setName('');
          setInvalid(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus aria-hidden />
            {t['processes.add']}
          </Button>
        }
      />
      <DialogContent
        title={t['processCreate.title']}
        description={t['processCreate.description']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={CREATE_FORM} disabled={busy}>
              {busy ? t['common.saving'] : t['processCreate.submit']}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field
            label={t['processCreate.name']}
            invalid={invalid === 'name'}
            error={t['common.required']}
          >
            <TextInput
              normalise="text"
              value={name}
              maxLength={255}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setInvalid(null);
              }}
            />
          </Field>
          <Field
            label={t['processCreate.key']}
            description={t['processCreate.keyHelp']}
            invalid={invalid === 'key' || invalid === 'taken'}
            error={
              invalid === 'taken' ? t['processCreate.keyTaken'] : t['processCreate.keyInvalid']
            }
          >
            <TextInput
              dir="ltr"
              value={key}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setKey(event.currentTarget.value.trim());
                setInvalid(null);
              }}
            />
          </Field>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
