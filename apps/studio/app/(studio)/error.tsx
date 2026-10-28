'use client';
import { Button, EmptyState, PageContainer } from '@phoenix/ui';
import { TriangleAlert } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { messagesFor } from '../_i18n/messages';

// A studio page that failed (the API answered an error, or a page threw), inside the shell.
// Replaces Next's built-in error page, whose inline style the CSP refuses. An error boundary
// gets no props from the server, so it reads the tenant's language from the document, which
// the root layout set; during hydration it renders the server's (English) snapshot.

const noSubscription = () => () => {};

export default function StudioError({ reset }: { readonly reset: () => void }) {
  const language = useSyncExternalStore(
    noSubscription,
    () => document.documentElement.lang,
    () => 'en',
  );
  const t = messagesFor(language || 'en');
  return (
    <PageContainer>
      <EmptyState
        icon={<TriangleAlert aria-hidden />}
        title={t['errorPage.title']}
        description={t['errorPage.description']}
        action={
          <Button variant="secondary" onClick={reset}>
            {t['errorPage.retry']}
          </Button>
        }
      />
    </PageContainer>
  );
}
