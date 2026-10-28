import { visibleMenu, type VisibleMenuEntry } from '@phoenix/panel-server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { isMessageKey } from '../_i18n/messages';
import { studioSession } from '../_server/session';
import { STUDIO_MENU } from '../menu';
import { SITE_COOKIE } from './_shell/site-cookie';
import { StudioShell, type ShellMenuEntry } from './_shell/studio-shell';

// The signed-in studio: who the member is, the menu of the keys they hold, and the sites they
// may switch between (read once per request by studioSession).

export default async function StudioLayout({ children }: { readonly children: ReactNode }) {
  const { tenant, t, held, sites, username, csrfToken } = await studioSession();
  const label = (key: string) => (isMessageKey(key) ? t[key] : key);
  const toShell = (entries: readonly VisibleMenuEntry[]): ShellMenuEntry[] =>
    entries.map((entry) => ({
      href: entry.href,
      label: label(entry.label),
      ...(entry.icon === undefined ? {} : { icon: entry.icon }),
      children: toShell(entry.children),
    }));

  const chosen = (await cookies()).get(SITE_COOKIE)?.value;
  const currentSite = sites.find((site) => site.id === chosen)?.id ?? sites[0]?.id ?? null;

  return (
    <StudioShell
      brand={tenant.displayName}
      menu={toShell(visibleMenu(STUDIO_MENU, held, ''))}
      sites={sites}
      currentSite={currentSite}
      username={username}
      csrfToken={csrfToken}
      messages={{
        nav: t['shell.nav'],
        openMenu: t['shell.openMenu'],
        closeMenu: t['shell.closeMenu'],
        collapseMenu: t['shell.collapseMenu'],
        expandMenu: t['shell.expandMenu'],
        siteLabel: t['site.label'],
        sitePlaceholder: t['site.placeholder'],
        accountMenu: t['account.menu'],
        signOut: t['account.signOut'],
        signOutFailed: t['account.signOutFailed'],
      }}
    >
      {children}
    </StudioShell>
  );
}
