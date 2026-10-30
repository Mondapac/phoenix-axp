import type { MenuEntry } from '@phoenix/panel-server';

// The studio menu (ADR-0023): each entry with the permission keys that show it. Labels are
// message keys (app/_i18n/messages.ts); icons are names the shell maps to icons.
export const STUDIO_MENU: readonly MenuEntry[] = [
  { href: '/', label: 'menu.home', icon: 'home', anyOf: [] },
  {
    href: '/tasks',
    label: 'menu.tasks',
    icon: 'tasks',
    anyOf: ['process.tasks.work', 'process.tasks.assign'],
  },
  {
    href: '/processes',
    label: 'menu.processes',
    icon: 'processes',
    anyOf: ['process.definitions.design'],
  },
  {
    href: '/people',
    label: 'menu.people',
    icon: 'people',
    anyOf: [],
    children: [
      { href: '/people/accounts', label: 'menu.accounts', anyOf: ['identity.accounts.view'] },
      { href: '/people/roles', label: 'menu.roles', anyOf: ['identity.roles.view'] },
    ],
  },
  {
    href: '/structure',
    label: 'menu.structure',
    icon: 'structure',
    anyOf: [],
    children: [
      { href: '/structure/sites', label: 'menu.sites', anyOf: ['tenancy.sites.view'] },
      {
        href: '/structure/organizations',
        label: 'menu.organizations',
        anyOf: ['tenancy.organizations.view'],
      },
    ],
  },
];
