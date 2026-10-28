import { Breadcrumb, EmptyState, type Crumb } from '@phoenix/ui';
import { ShieldOff } from 'lucide-react';
import type { Messages } from '../../_i18n/messages';

// Server-rendered parts shared by the studio's pages.

/** What a page shows when the API refused the member its read. */
export function NoAccess({ t }: { readonly t: Messages }) {
  return (
    <EmptyState
      icon={<ShieldOff aria-hidden />}
      title={t['noAccess.title']}
      description={t['noAccess.description']}
    />
  );
}

/** The page's breadcrumb, with its accessible name. */
export function PageCrumbs({ t, items }: { readonly t: Messages; readonly items: Crumb[] }) {
  return <Breadcrumb label={t['common.breadcrumb']} items={items} />;
}
