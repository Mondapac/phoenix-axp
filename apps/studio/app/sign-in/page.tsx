import { Alert, Button, Card, CardContent, CardDescription, CardTitle } from '@phoenix/ui';
import { messagesFor } from '../_i18n/messages';
import { tenantPresentation } from '../_server/panel';

// The staff sign-in page: the tenant's name and one way in, the tenant's Keycloak realm. A link,
// not a form: the start route answers a redirect, which `form-action 'self'` would block.

interface Props {
  readonly searchParams: Promise<{ readonly error?: string | string[] }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const tenant = await tenantPresentation();
  const t = messagesFor(tenant.defaultLocale);
  const { error } = await searchParams;
  const problem =
    error === 'unavailable'
      ? t['signIn.error.unavailable']
      : error === 'refused'
        ? t['signIn.error.refused']
        : null;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 py-8">
          <div className="space-y-1 text-center">
            <p className="text-sm text-fg-muted">{tenant.displayName}</p>
            <CardTitle className="text-xl">{t['signIn.title']}</CardTitle>
            <CardDescription>{t['signIn.description']}</CardDescription>
          </div>
          {problem === null ? null : <Alert tone="critical">{problem}</Alert>}
          <Button
            className="w-full"
            nativeButton={false}
            render={<a href="/auth/start">{t['signIn.action']}</a>}
          />
        </CardContent>
      </Card>
    </main>
  );
}
