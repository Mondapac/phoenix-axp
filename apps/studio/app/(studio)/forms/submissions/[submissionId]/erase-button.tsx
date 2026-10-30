'use client';
import { Button, DialogTrigger } from '@phoenix/ui';
import { Eraser } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { callApi } from '../../../../_client/api';
import type { Messages } from '../../../../_i18n/messages';
import { ConfirmDialog } from '../../../_components/confirm-dialog';

/** Erases a submission's personal data on request (owner decision D5): final. */
export function EraseSubmissionButton(props: {
  readonly t: Messages;
  readonly csrfToken: string;
  readonly submission: { readonly id: string; readonly version: number };
}) {
  const { t, submission } = props;
  const router = useRouter();
  return (
    <ConfirmDialog
      t={t}
      trigger={
        <DialogTrigger
          render={
            <Button variant="outline" className="text-critical">
              <Eraser aria-hidden />
              {t['submission.erase']}
            </Button>
          }
        />
      }
      title={t['submission.erase.title']}
      description={t['submission.erase.description']}
      confirmLabel={t['submission.erase.confirm']}
      onConfirm={() =>
        callApi('POST', `forms/submissions/${submission.id}/erase`, props.csrfToken, {
          version: submission.version,
        })
      }
      onDone={() => router.refresh()}
    />
  );
}
