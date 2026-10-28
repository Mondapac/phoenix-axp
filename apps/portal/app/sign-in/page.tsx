import { Card, CardContent, CardDescription, CardTitle, EmptyState } from '@phoenix/ui';
import { redirect } from 'next/navigation';
import { messagesFor } from '../_i18n/messages';
import { readApi, tenantPresentation } from '../_server/panel';
import { SignInFlow, type PortalMethod } from './sign-in-flow';

// Portal sign-in and sign-up, one flow (ADR-0026): the methods the tenant offers, then a
// one-time code. The options are read without the browser's cookies, so a stale session
// cannot break the page.

interface SignInOptions {
  readonly methods: readonly PortalMethod[];
  readonly countryCallingCode: string | null;
}

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const [tenant, options, me] = await Promise.all([
    tenantPresentation(),
    readApi<SignInOptions>('identity/portal/sign-in-options', { anonymous: true }),
    readApi<unknown>('identity/portal/me'),
  ]);
  // Already signed in: the account page.
  if (me.ok) redirect('/');
  if (!options.ok) throw new Error(`identity/portal/sign-in-options answered ${options.status}`);
  const t = messagesFor(tenant.defaultLocale);
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6 py-8">
          <div className="space-y-1 text-center">
            <p className="text-sm text-fg-muted">{tenant.displayName}</p>
            <CardTitle className="text-xl">{t['signIn.title']}</CardTitle>
            {options.body.methods.length === 0 ? null : (
              <CardDescription>{t['signIn.description']}</CardDescription>
            )}
          </div>
          {options.body.methods.length === 0 ? (
            <EmptyState
              title={t['signIn.closed.title']}
              description={t['signIn.closed.description']}
            />
          ) : (
            <SignInFlow
              locale={tenant.defaultLocale}
              methods={options.body.methods}
              countryCallingCode={options.body.countryCallingCode}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
