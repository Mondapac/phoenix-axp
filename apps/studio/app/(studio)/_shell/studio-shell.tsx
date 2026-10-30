'use client';
import {
  Alert,
  AppShell,
  Avatar,
  buttonClasses,
  cn,
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
  Select,
  type NavItem,
} from '@phoenix/ui';
import { Boxes, Building2, House, LogOut, Network, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { indentedSiteName } from '../../_lib/people';
import { SITE_COOKIE } from './site-cookie';

// The studio shell (ADR-0023) on the client: the menu the server built from the member's keys,
// the current page marked from the path, the site switcher and the account menu. It holds no
// permission logic: the server sent only what the member may see, and the API decides.

export interface ShellMenuEntry {
  readonly href: string;
  readonly label: string;
  readonly icon?: string;
  readonly children: readonly ShellMenuEntry[];
}

export interface ShellSite {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

export interface ShellMessages {
  readonly nav: string;
  readonly openMenu: string;
  readonly closeMenu: string;
  readonly collapseMenu: string;
  readonly expandMenu: string;
  readonly siteLabel: string;
  readonly sitePlaceholder: string;
  readonly accountMenu: string;
  readonly signOut: string;
  readonly signOutFailed: string;
}

const ICONS: Readonly<Record<string, ReactNode>> = {
  home: <House aria-hidden />,
  people: <Users aria-hidden />,
  structure: <Network aria-hidden />,
  objects: <Boxes aria-hidden />,
};

function isCurrent(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navItems(entries: readonly ShellMenuEntry[], pathname: string): NavItem[] {
  return entries.map((entry) => ({
    href: entry.href,
    label: entry.label,
    icon: entry.icon === undefined ? undefined : ICONS[entry.icon],
    active: isCurrent(entry.href, pathname),
    ...(entry.children.length === 0 ? {} : { children: navItems(entry.children, pathname) }),
  }));
}

function initialsOf(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
}

export function StudioShell(props: {
  readonly brand: string;
  readonly menu: readonly ShellMenuEntry[];
  readonly sites: readonly ShellSite[];
  readonly currentSite: string | null;
  readonly username: string;
  readonly csrfToken: string;
  readonly messages: ShellMessages;
  readonly children: ReactNode;
}) {
  const { brand, menu, sites, username, csrfToken, messages: t, children } = props;
  const pathname = usePathname();
  const [site, setSite] = useState(props.currentSite);
  const [signOutFailed, setSignOutFailed] = useState(false);

  function chooseSite(value: string | null) {
    if (value === null) return;
    setSite(value);
    document.cookie = `${SITE_COOKIE}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=Strict; Max-Age=31536000`;
  }

  async function signOut() {
    setSignOutFailed(false);
    const answer = await fetch('/api/identity/staff/sign-out', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    }).catch(() => null);
    if (answer === null || (!answer.ok && answer.status !== 401)) {
      setSignOutFailed(true);
      return;
    }
    window.location.assign('/sign-in');
  }

  const siteSwitcher =
    sites.length === 0 ? null : (
      <Select
        aria-label={t.siteLabel}
        placeholder={t.sitePlaceholder}
        className="max-w-64"
        value={site}
        onValueChange={chooseSite}
        options={sites.map((s) => ({
          value: s.id,
          label: indentedSiteName(s),
        }))}
      />
    );

  const accountMenu = (
    <Menu>
      <MenuTrigger
        aria-label={t.accountMenu}
        className={cn(buttonClasses('ghost', 'md'), 'gap-2 px-2')}
      >
        <Avatar name={username} initials={initialsOf(username)} size="sm" />
        <span className="max-w-40 truncate max-sm:hidden">{username}</span>
      </MenuTrigger>
      <MenuContent>
        <MenuGroupLabel>{username}</MenuGroupLabel>
        <MenuItem onClick={() => void signOut()}>
          <LogOut aria-hidden />
          {t.signOut}
        </MenuItem>
      </MenuContent>
    </Menu>
  );

  return (
    <AppShell
      brand={
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <Building2 className="size-5 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{brand}</span>
        </span>
      }
      brandMark={<Building2 className="size-5 text-accent" aria-label={brand} />}
      nav={[{ items: navItems(menu, pathname) }]}
      labels={{
        nav: t.nav,
        openMenu: t.openMenu,
        closeMenu: t.closeMenu,
        collapseMenu: t.collapseMenu,
        expandMenu: t.expandMenu,
      }}
      headerStart={siteSwitcher}
      headerEnd={accountMenu}
    >
      {signOutFailed ? (
        <div className="px-4 pt-4 sm:px-6">
          <Alert tone="critical">{t.signOutFailed}</Alert>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
