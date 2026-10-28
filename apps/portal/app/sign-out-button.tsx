'use client';
import { Alert, Button } from '@phoenix/ui';
import { useState } from 'react';
import { postApi } from './_client/api';

/** Ends the session, then goes to sign-in. */
export function SignOutButton({
  label,
  failed,
  csrfToken,
}: {
  readonly label: string;
  readonly failed: string;
  readonly csrfToken: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  async function signOut() {
    setBusy(true);
    setProblem(false);
    const answer = await postApi('identity/portal/sign-out', undefined, csrfToken);
    if (answer.ok) {
      window.location.assign('/sign-in');
      return;
    }
    setBusy(false);
    setProblem(true);
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void signOut()}>
        {label}
      </Button>
      {problem ? <Alert tone="critical">{failed}</Alert> : null}
    </div>
  );
}
