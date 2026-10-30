'use client';
import { Alert, Button, Dialog, DialogClose, DialogContent } from '@phoenix/ui';
import { useState, type ReactNode } from 'react';
import { failureMessage, type ApiAnswer } from '../../_lib/api-answer';
import type { Messages } from '../../_i18n/messages';

// A confirmation before a change that ends someone's access (disable, revoke) or that others
// will feel (publish): the trigger, the question, and the API's refusal shown in place.

export function ConfirmDialog(props: {
  readonly t: Messages;
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => Promise<ApiAnswer<unknown>>;
  readonly onDone: () => void;
  /** Called on a stale version (409 `conflict.stale`), so the page reads the current one. */
  readonly onStale?: () => void;
  /** `primary` for a change that takes nothing away; `danger` by default. */
  readonly confirmVariant?: 'danger' | 'primary';
}) {
  const { t, title, description, confirmLabel } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    const answer = await props.onConfirm();
    setBusy(false);
    if (answer.ok) {
      setOpen(false);
      props.onDone();
    } else {
      setProblem(t[failureMessage(answer)]);
      if (answer.code === 'conflict.stale') props.onStale?.();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setProblem(null);
      }}
    >
      {props.trigger}
      <DialogContent
        title={title}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button
              variant={props.confirmVariant ?? 'danger'}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? t['common.saving'] : confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-fg">{description}</p>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
