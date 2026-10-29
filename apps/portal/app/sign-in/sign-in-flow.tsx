'use client';
import { Alert, Button, Field, Ltr, Tab, TabList, Tabs, TextInput } from '@phoenix/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { postApi } from '../_client/api';
import { fill, messagesFor } from '../_i18n/messages';
import { failureMessage, type ApiAnswer } from '../_lib/api-answer';
import { solveChallenge, type ProofOfWorkChallenge } from '../_lib/proof-of-work';

// The two steps of sign-in (ADR-0026): an address and a CAPTCHA solved in the browser send a
// code; the code starts the session. The answer never says whether the address had an account.

export type PortalMethod = 'email' | 'mobile';

/** Seconds before the visitor may ask for another code. */
const RESEND_AFTER_SECONDS = 60;

interface Sent {
  readonly challengeId: string;
  readonly method: PortalMethod;
  readonly address: string;
}

/** Asks the API for a CAPTCHA, solves it, and asks for a code to `address`. */
async function sendCode(method: PortalMethod, address: string): Promise<ApiAnswer<Sent>> {
  const challenge = await postApi<ProofOfWorkChallenge>('identity/portal/challenge');
  if (!challenge.ok) return challenge;
  const captcha = await solveChallenge(challenge.body);
  if (captcha === null) return { ok: false, status: 400, code: 'captcha.invalid' };
  const sent = await postApi<{ challengeId: string }>('identity/portal/code', {
    method,
    address,
    captcha,
  });
  return sent.ok
    ? { ok: true, body: { challengeId: sent.body.challengeId, method, address } }
    : sent;
}

export function SignInFlow({
  locale,
  methods,
  countryCallingCode,
}: {
  readonly locale: string;
  readonly methods: readonly PortalMethod[];
  readonly countryCallingCode: string | null;
}) {
  const t = messagesFor(locale);
  const [method, setMethod] = useState<PortalMethod>(methods[0] ?? 'email');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const answer = await sendCode(sent?.method ?? method, sent?.address ?? address);
    setBusy(false);
    if (!answer.ok) {
      setProblem(t[failureMessage(answer)]);
      return;
    }
    if (sent !== null) setNotice(t['code.resent']);
    setSent(answer.body);
    setCode('');
    setWait(RESEND_AFTER_SECONDS);
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (sent === null) return;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const answer = await postApi('identity/portal/sign-in', { ...sent, code });
    if (answer.ok) {
      // A full load: the server reads the new session cookie.
      window.location.assign('/');
      return;
    }
    setBusy(false);
    setProblem(t[failureMessage(answer)]);
  }

  const alerts = (
    <>
      {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
    </>
  );

  if (sent !== null) {
    return (
      <form className="space-y-5" onSubmit={(event) => void signIn(event)} noValidate>
        <p className="text-sm text-fg-muted">
          {t['code.sentTo']} <Ltr className="font-medium text-fg">{sent.address}</Ltr>
        </p>
        {alerts}
        <Field label={t['code.label']}>
          <TextInput
            name="code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            normalise="identifier"
            maxLength={6}
            pattern="[0-9]{6}"
            required
            autoFocus
            className="text-center text-lg tracking-widest"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? t['code.checking'] : t['code.submit']}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || wait > 0}
            onClick={() => void requestCode()}
          >
            {wait > 0 ? fill(t['code.resendIn'], { seconds: String(wait) }) : t['code.resend']}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSent(null);
              setCode('');
              setProblem(null);
              setNotice(null);
            }}
          >
            {t['code.change']}
          </Button>
        </div>
      </form>
    );
  }

  const field =
    method === 'email' ? (
      <Field label={t['signIn.address.email']}>
        <TextInput
          name="email"
          type="email"
          dir="ltr"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          value={address}
          onChange={(e) => setAddress(e.currentTarget.value)}
        />
      </Field>
    ) : (
      <Field
        label={t['signIn.address.mobile']}
        description={countryCallingCode === null ? undefined : t['signIn.address.mobileHint']}
      >
        <TextInput
          name="mobile"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          normalise="identifier"
          maxLength={20}
          required
          value={address}
          onChange={(e) => setAddress(e.currentTarget.value)}
        />
      </Field>
    );

  return (
    <form className="space-y-5" onSubmit={(event) => void requestCode(event)} noValidate>
      {methods.length > 1 ? (
        <Tabs
          value={method}
          onValueChange={(value: PortalMethod) => {
            setMethod(value);
            setAddress('');
            setProblem(null);
          }}
        >
          <TabList aria-label={t['signIn.method']}>
            {methods.map((option) => (
              <Tab key={option} value={option} className="flex-1">
                {t[`signIn.method.${option}`]}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      ) : null}
      {alerts}
      {field}
      <Button type="submit" className="w-full" disabled={busy || address.trim() === ''}>
        {busy ? t['signIn.sending'] : t['signIn.send']}
      </Button>
    </form>
  );
}
