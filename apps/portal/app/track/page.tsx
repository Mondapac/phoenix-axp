import { messagesFor } from '../_i18n/messages';
import { tenantPresentation } from '../_server/panel';
import { TrackFlow } from './track-flow';

// Following a submission by its tracking code, without signing in (slice 2.5): the form's
// name, the status and when it was sent; never an answer.

export const dynamic = 'force-dynamic';

export default async function TrackPage() {
  const tenant = await tenantPresentation();
  const t = messagesFor(tenant.defaultLocale);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6 sm:py-10">
      <p className="text-sm font-semibold text-fg-muted">{tenant.displayName}</p>
      <h1 className="text-xl font-semibold text-fg">{t['track.title']}</h1>
      <TrackFlow
        locale={tenant.defaultLocale}
        calendar={tenant.calendar}
        timeZone={tenant.timeZone}
      />
    </main>
  );
}
