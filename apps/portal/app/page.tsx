import { Card, CardContent, CardDescription, CardHeader, CardTitle, Ltr } from '@phoenix/ui';
import { portalSession } from './_server/session';
import { SignOutButton } from './sign-out-button';

// "My account": the signed-in portal user's ways in, masked (ADR-0026 decision 5).

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const { t, tenant, contacts, csrfToken } = await portalSession();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-fg">{tenant.displayName}</p>
        <SignOutButton
          label={t['account.signOut']}
          failed={t['account.signOutFailed']}
          csrfToken={csrfToken}
        />
      </header>
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t['account.title']}</CardTitle>
            <CardDescription>{t['account.description']}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-line">
            {contacts.map((contact) => (
              <div
                key={contact.method}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <dt className="text-sm text-fg-muted">{t[`account.contact.${contact.method}`]}</dt>
                <dd className="text-sm font-medium text-fg">
                  {contact.masked === null ? (
                    t['account.contact.unreadable']
                  ) : (
                    <Ltr>{contact.masked}</Ltr>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </main>
  );
}
