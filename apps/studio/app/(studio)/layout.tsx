import {
  heldKeys,
  visibleMenu,
  type OwnPermissions,
  type VisibleMenuEntry,
} from '@phoenix/panel-server';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isMessageKey, messagesFor } from '../_i18n/messages';
import { readApi, tenantPresentation } from '../_server/panel';
import { STUDIO_MENU } from '../menu';
import { SITE_COOKIE } from './_shell/site-cookie';
import { StudioShell, type ShellMenuEntry, type ShellSite } from './_shell/studio-shell';

// The signed-in studio: who the member is, the menu of the keys they hold, and the sites they
// may switch between. Read from the API on every request (no session or permission cache,
// ADR-0004 decision 2); a request without a live session goes to sign-in.

interface OwnAccount {
  readonly accountId: string;
  readonly username: string;
  readonly csrfToken: string;
}

interface Site {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

export default async function StudioLayout({ children }: { readonly children: ReactNode }) {
  const me = await readApi<OwnAccount>('identity/staff/me');
  if (me.status === 404) notFound();
  if (me.status === 401 || me.status === 403) redirect('/sign-in');
  if (!me.ok) throw new Error(`identity/staff/me answered ${me.status}`);

  const [tenant, permissions] = await Promise.all([
    tenantPresentation(),
    readApi<OwnPermissions>('identity/staff/me/permissions'),
  ]);
  if (permissions.status === 401 || permissions.status === 403) redirect('/sign-in');
  if (!permissions.ok)
    throw new Error(`identity/staff/me/permissions answered ${permissions.status}`);
  const held = heldKeys(permissions.body);
  const t = messagesFor(tenant.defaultLocale);
  const label = (key: string) => (isMessageKey(key) ? t[key] : key);
  const toShell = (entries: readonly VisibleMenuEntry[]): ShellMenuEntry[] =>
    entries.map((entry) => ({
      href: entry.href,
      label: label(entry.label),
      ...(entry.icon === undefined ? {} : { icon: entry.icon }),
      children: toShell(entry.children),
    }));

  let sites: ShellSite[] = [];
  if (held.has('tenancy.sites.view')) {
    const listed = await readApi<{ items: Site[] }>('tenancy/sites');
    if (listed.ok) {
      sites = listed.body.items.map((site) => ({
        id: site.id,
        name: site.name,
        depth: site.depth,
      }));
    }
  }
  const chosen = (await cookies()).get(SITE_COOKIE)?.value;
  const currentSite = sites.find((site) => site.id === chosen)?.id ?? sites[0]?.id ?? null;

  return (
    <StudioShell
      brand={tenant.displayName}
      menu={toShell(visibleMenu(STUDIO_MENU, held, ''))}
      sites={sites}
      currentSite={currentSite}
      username={me.body.username}
      csrfToken={me.body.csrfToken}
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
