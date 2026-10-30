'use client';
import { Alert, Button, Card, CardContent, Field, TextInput } from '@phoenix/ui';
import { useState, type FormEvent } from 'react';
import { postApi } from '../_client/api';
import { messagesFor } from '../_i18n/messages';
import { failureMessage } from '../_lib/api-answer';

interface Tracked {
  readonly form: { readonly name: string };
  readonly status: string;
  readonly submittedAt: string;
}

export function TrackFlow(props: {
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
}) {
  const t = messagesFor(props.locale);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Tracked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    setFound(null);
    if (code.trim() === '') return setProblem(t['formError.required']);
    setBusy(true);
    // The code goes in the body, never in a URL (access logs).
    const answer = await postApi<Tracked>('public/forms/tracking', { trackingCode: code.trim() });
    setBusy(false);
    if (answer.ok) return setFound(answer.body);
    setProblem(answer.status === 404 ? t['track.notFound'] : t[failureMessage(answer)]);
  }

  const when = (instant: string) => {
    const ms = Date.parse(instant);
    return Number.isNaN(ms)
      ? instant
      : new Intl.DateTimeFormat(`${props.locale}-u-ca-${props.calendar}`, {
          timeZone: props.timeZone,
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(ms);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-6">
          <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
            <p className="text-sm text-fg-muted">{t['track.description']}</p>
            <Field label={t['track.code']}>
              <TextInput
                value={code}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                normalise="identifier"
                className="text-start tracking-wider"
                maxLength={64}
                onChange={(event) => setCode(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? t['track.checking'] : t['track.submit']}
            </Button>
          </form>
        </CardContent>
      </Card>
      {problem === null ? null : (
        <Alert tone="critical" role="alert">
          {problem}
        </Alert>
      )}
      {found === null ? null : (
        <Card>
          <CardContent className="py-5">
            <dl className="divide-y divide-line text-sm" aria-live="polite">
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-fg-muted">{t['track.form']}</dt>
                <dd className="font-medium text-fg">
                  <bdi>{found.form.name}</bdi>
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-fg-muted">{t['track.status']}</dt>
                <dd className="font-medium text-fg">
                  {found.status === 'received' ? t['status.received'] : found.status}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-fg-muted">{t['track.submittedAt']}</dt>
                <dd className="font-medium text-fg">{when(found.submittedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
