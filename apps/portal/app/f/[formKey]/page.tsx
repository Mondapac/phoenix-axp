import { buttonClasses, Card, CardContent, EmptyState } from '@phoenix/ui';
import { FileX } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { messagesFor } from '../../_i18n/messages';
import { isFormKey } from '../../_lib/form-texts';
import { readApi, tenantPresentation } from '../../_server/panel';
import { PublicForm, type PublishedForm } from './public-form';

// A published form on the portal (GET public/forms/:key, slice 2.5), mobile first. The API
// decides who may see it: a visitor without a session sees only a form open to anyone; a
// signed-in visitor gets the forms their policy admits. A visitor's submission needs the
// proof-of-work CAPTCHA, solved in the browser.

export const dynamic = 'force-dynamic';

interface Props {
  readonly params: Promise<{ readonly formKey: string }>;
}

export default async function PublicFormPage({ params }: Props) {
  const { formKey } = await params;
  if (!isFormKey(formKey)) notFound();
  const tenant = await tenantPresentation();
  const t = messagesFor(tenant.defaultLocale);
  let form = await readApi<PublishedForm>(`public/forms/${formKey}`);
  // A stale session cookie: read as a visitor.
  if (form.status === 401)
    form = await readApi<PublishedForm>(`public/forms/${formKey}`, { anonymous: true });
  const me =
    form.ok && !form.body.captchaRequired
      ? await readApi<{ csrfToken: string }>('identity/portal/me')
      : null;
  if (!form.ok && form.status !== 404) throw new Error(`public/forms answered ${form.status}`);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:py-10">
      <p className="text-sm font-semibold text-fg-muted">{tenant.displayName}</p>
      {form.ok ? (
        <PublicForm
          formKey={formKey}
          form={form.body}
          locale={tenant.defaultLocale}
          calendar={tenant.calendar}
          timeZone={tenant.timeZone}
          csrfToken={me?.ok ? me.body.csrfToken : undefined}
        />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={<FileX aria-hidden />}
              title={t['form.notFound.title']}
              description={t['form.notFound.description']}
              action={
                <Link href="/sign-in" className={buttonClasses('outline')}>
                  {t['form.signIn']}
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
