'use client';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardContent,
  CardTitle,
  Checkbox,
  Ltr,
  SchemaForm,
  todayIn,
  toLocaleDigits,
} from '@phoenix/ui';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { postApi } from '../../_client/api';
import { messagesFor } from '../../_i18n/messages';
import { failureMessage } from '../../_lib/api-answer';
import { schemaFormTexts } from '../../_lib/form-texts';
import { solveChallenge, type ProofOfWorkChallenge } from '../../_lib/proof-of-work';

// The form itself: answers checked in the browser with the same schema the API checks again,
// a CAPTCHA for a visitor without a session, and the tracking code once it is sent.

export interface PublishedForm {
  readonly name: string;
  readonly revisionId: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly uiSchema: Record<string, unknown>;
  readonly captchaRequired: boolean;
  readonly onBehalfOffered: boolean;
}

type Phase = 'filling' | 'checking' | 'sending';

export function PublicForm(props: {
  readonly formKey: string;
  readonly form: PublishedForm;
  readonly locale: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly csrfToken: string | undefined;
}) {
  const { form, locale } = props;
  const t = messagesFor(locale);
  const texts = useMemo(() => schemaFormTexts(t), [t]);
  const [today] = useState(() => todayIn(props.timeZone));
  const [data, setData] = useState<Record<string, unknown>>({});
  const [valid, setValid] = useState(false);
  const [tried, setTried] = useState(false);
  const [onBehalf, setOnBehalf] = useState(false);
  const [phase, setPhase] = useState<Phase>('filling');
  const [problem, setProblem] = useState<string | null>(null);
  const [trackingCode, setTrackingCode] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  async function submit() {
    setTried(true);
    setProblem(null);
    if (!valid) {
      setProblem(t['form.fixErrors']);
      return;
    }
    let captcha: string | undefined;
    if (form.captchaRequired) {
      setPhase('checking');
      const challenge = await fetchChallenge();
      captcha = challenge === null ? undefined : ((await solveChallenge(challenge)) ?? undefined);
      if (captcha === undefined) {
        setPhase('filling');
        setProblem(t['error.captcha']);
        return;
      }
    }
    setPhase('sending');
    const answer = await postApi<{ trackingCode: string }>(
      `public/forms/${props.formKey}/submissions`,
      {
        answers: data,
        ...(captcha === undefined ? {} : { captcha }),
        ...(onBehalf ? { onBehalf: true } : {}),
      },
      props.csrfToken,
    );
    setPhase('filling');
    if (answer.ok) {
      setTrackingCode(answer.body.trackingCode);
      return;
    }
    setProblem(t[failureMessage(answer)]);
  }

  if (trackingCode !== null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <CircleCheck className="size-12 text-success" aria-hidden />
          <div className="space-y-1">
            <CardTitle className="text-xl">{t['form.sent.title']}</CardTitle>
            <p className="text-sm text-fg-muted">{t['form.sent.description']}</p>
          </div>
          <div className="w-full max-w-xs space-y-1 rounded-card border border-line bg-subtle px-4 py-3">
            <p className="text-xs text-fg-muted">{t['form.sent.code']}</p>
            <p className="text-xl font-semibold tracking-wider text-fg" aria-live="polite">
              <Ltr>{toLocaleDigits(trackingCode, locale)}</Ltr>
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/track" className={buttonClasses('outline')}>
              {t['form.sent.track']}
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setTrackingCode(null);
                setData({});
                setTried(false);
                setRound((n) => n + 1);
              }}
            >
              {t['form.sent.again']}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const busy = phase !== 'filling';
  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        <h1 className="text-xl font-semibold text-fg">
          <bdi>{form.name}</bdi>
        </h1>
        {form.onBehalfOffered ? (
          <Checkbox label={t['form.onBehalf']} checked={onBehalf} onCheckedChange={setOnBehalf} />
        ) : null}
        <SchemaForm
          key={round}
          jsonSchema={form.jsonSchema}
          uiSchema={form.uiSchema}
          data={data}
          onChange={(next, isValid) => {
            setData(next);
            setValid(isValid);
          }}
          locale={locale}
          calendar={props.calendar}
          today={today}
          texts={texts}
          showErrors={tried}
          readonly={busy}
          footer={
            <Button
              size="lg"
              className="max-sm:w-full"
              disabled={busy}
              onClick={() => void submit()}
            >
              {phase === 'checking'
                ? t['form.checking']
                : phase === 'sending'
                  ? t['form.submitting']
                  : t['form.submit']}
            </Button>
          }
        />
        {problem === null ? null : (
          <Alert tone="critical" role="alert">
            {problem}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

async function fetchChallenge(): Promise<ProofOfWorkChallenge | null> {
  const response = await fetch('/api/public/forms/challenge').catch(() => null);
  if (response === null || !response.ok) return null;
  return (await response.json().catch(() => null)) as ProofOfWorkChallenge | null;
}
