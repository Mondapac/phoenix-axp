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
} from '@phoenix/ui';
import { Move } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { callApi } from '../../../_client/api';
import { failureMessage } from '../../../_lib/api-answer';
import { indentedSiteName } from '../../../_lib/people';
import { ROOT_OPTION } from '../../../_lib/structure';
import { fill, type Messages } from '../../../_i18n/messages';

// Moving a node of a tree (a site or an organization unit) with its subtree under another
// parent, or to the top. The targets exclude the node's own subtree; the API checks it again,
// with the depth ceiling, under the tenant's structure lock.

const MOVE_FORM = 'move-node';

export interface MoveTarget {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

export function MoveDialog(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly name: string;
  readonly description: string;
  readonly rootLabel: string;
  readonly currentParentId: string | null;
  readonly targets: readonly MoveTarget[];
  /** The API route of the move and the body field that names the new parent. */
  readonly route: string;
  readonly parentField: 'newParentSiteId' | 'newParentId';
}) {
  const { t, csrfToken, targets } = props;
  const router = useRouter();
  const current = props.currentParentId ?? ROOT_OPTION;
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState<string>(current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = [
    { value: ROOT_OPTION, label: props.rootLabel },
    ...targets.map((target) => ({ value: target.id, label: indentedSiteName(target) })),
  ];
  const nowhere = options.length === 1 && current === ROOT_OPTION;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    if (parent === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const answer = await callApi('POST', props.route, csrfToken, {
      [props.parentField]: parent === ROOT_OPTION ? null : parent,
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
          setParent(current);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Move aria-hidden />
            {t['move.open']}
          </Button>
        }
      />
      <DialogContent
        title={fill(t['move.title'], { name: props.name })}
        description={props.description}
        closeLabel={t['common.close']}
        footer={
          <>
            <DialogClose render={<Button variant="outline">{t['common.cancel']}</Button>} />
            <Button type="submit" form={MOVE_FORM} disabled={busy || nowhere}>
              {busy ? t['common.saving'] : t['move.submit']}
            </Button>
          </>
        }
      >
        <form id={MOVE_FORM} className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
          {nowhere ? (
            <Alert tone="info">{t['move.nowhere']}</Alert>
          ) : (
            <Field label={t['move.parent']}>
              <Select
                value={parent}
                onValueChange={(value) => {
                  if (value !== null) setParent(value);
                  setProblem(null);
                }}
                options={options}
              />
            </Field>
          )}
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
