'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Field,
  Ltr,
  Select,
} from '@phoenix/ui';
import { Check, Hand, Undo2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '../../../_client/api';
import { fill, type Messages } from '../../../_i18n/messages';
import { failureMessage } from '../../../_lib/api-answer';
import type { TaskStanding } from '../../../_lib/process';
import { ConfirmDialog } from '../../_components/confirm-dialog';

// What the member can do with a task (ADR-0025): take it from its queue, give it back, decide it
// with one of its outcomes, or, as a supervisor, give it to a person. The API decides each one
// (a deadline that passed wins, R7); the screen offers what the task's standing allows.

export function TaskActions(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly taskId: string;
  readonly standing: TaskStanding;
  readonly outcomes: readonly string[];
  /** The task can go back to a queue (it has one). */
  readonly releasable: boolean;
}) {
  const { t, csrfToken, taskId, standing } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function post(action: 'claim' | 'release') {
    setBusy(true);
    setProblem(null);
    const answer = await callApi('POST', `process/tasks/${taskId}/${action}`, csrfToken);
    setBusy(false);
    if (answer.ok) router.refresh();
    else setProblem(t[failureMessage(answer)]);
  }

  const complete = (outcome: string | null) =>
    callApi('POST', `process/tasks/${taskId}/complete`, csrfToken, { outcome });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {standing === 'queue' ? (
          <Button disabled={busy} onClick={() => void post('claim')}>
            <Hand aria-hidden />
            {t['task.claim']}
          </Button>
        ) : null}
        {standing === 'mine' && props.outcomes.length === 0 ? (
          <ConfirmDialog
            t={t}
            trigger={
              <DialogTrigger
                render={
                  <Button>
                    <Check aria-hidden />
                    {t['task.complete']}
                  </Button>
                }
              />
            }
            title={t['task.complete.title']}
            description={t['task.complete.description']}
            confirmLabel={t['task.complete']}
            onConfirm={() => complete(null)}
            onDone={() => router.refresh()}
          />
        ) : null}
        {standing === 'mine'
          ? props.outcomes.map((outcome) => (
              <ConfirmDialog
                key={outcome}
                t={t}
                trigger={
                  <DialogTrigger
                    render={
                      <Button variant="outline">
                        <Check aria-hidden />
                        <Ltr>{outcome}</Ltr>
                      </Button>
                    }
                  />
                }
                title={t['task.complete.title']}
                description={fill(t['task.complete.withOutcome'], { outcome })}
                confirmLabel={t['task.complete']}
                onConfirm={() => complete(outcome)}
                onDone={() => router.refresh()}
              />
            ))
          : null}
        {standing === 'mine' && props.releasable ? (
          <Button variant="ghost" disabled={busy} onClick={() => void post('release')}>
            <Undo2 aria-hidden />
            {t['task.release']}
          </Button>
        ) : null}
      </div>
      {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
    </div>
  );
}

const ASSIGN_FORM = 'assign-task';

export function AssignTaskDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly taskId: string;
  readonly people: readonly { readonly value: string; readonly label: string }[];
}) {
  const { t, csrfToken, taskId, people } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (accountId === null) return setMissing(true);
    setBusy(true);
    const answer = await callApi('POST', `process/tasks/${taskId}/assign`, csrfToken, {
      accountId,
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
          setAccountId(null);
          setMissing(false);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <UserPlus aria-hidden />
            {t['task.assign']}
          </Button>
        }
      />
      <DialogContent
        title={t['task.assign.title']}
        description={t['task.assign.description']}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={ASSIGN_FORM} disabled={busy || people.length === 0}>
              {busy ? t['common.saving'] : t['task.assign.submit']}
            </Button>
          </>
        }
      >
        <form id={ASSIGN_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          {people.length === 0 ? (
            <Alert tone="warning">{t['task.assign.noPeople']}</Alert>
          ) : (
            <Field label={t['task.assign.person']} invalid={missing} error={t['common.required']}>
              <Select
                placeholder={t['modeler.pick.placeholder']}
                value={accountId}
                onValueChange={(value) => {
                  setAccountId(value);
                  setMissing(false);
                }}
                options={[...people]}
              />
            </Field>
          )}
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
