'use client';
import { Collapsible } from '@base-ui/react/collapsible';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { ChevronDown, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge } from './badge';
import { buttonClasses } from './button-classes';
import { DirectionalIcon } from './bidi';
import { SheetContent, Tooltip } from './overlay';

// The panel shell shared by apps/admin and apps/studio (ADR-0016 decision 3): a side menu that
// collapses to icons on a desktop and becomes a sheet on a phone, a sticky header and the page.
// The menu is data: the panel builds it from the user's permission keys. Every text is a prop.

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  badge?: ReactNode;
  children?: NavItem[];
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface ShellLabels {
  /** The accessible name of the side menu landmark. */
  nav: string;
  openMenu: string;
  closeMenu: string;
  collapseMenu: string;
  expandMenu: string;
}

export interface AppShellProps {
  /** Logo and name of the panel or tenant, shown at the top of the side menu. */
  brand: ReactNode;
  /** The logo alone, for the collapsed side menu. */
  brandMark: ReactNode;
  nav: NavSection[];
  labels: ShellLabels;
  /** Header content at the inline start (search, site switcher) and end (alerts, user menu). */
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  sidebarFooter?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

const ITEM =
  'flex h-10 w-full min-w-0 items-center gap-3 rounded-control px-3 text-sm font-medium text-sidebar-fg no-underline transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[1.125rem] [&_svg]:shrink-0';
const ACTIVE =
  'bg-sidebar-active text-sidebar-active-fg hover:bg-sidebar-active hover:text-sidebar-active-fg';

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <a
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(ITEM, item.active && ACTIVE, collapsed && 'justify-center px-0')}
    >
      {item.icon}
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {collapsed || item.badge === undefined ? null : <Badge tone="accent">{item.badge}</Badge>}
    </a>
  );
  return collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link;
}

function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const children = item.children ?? [];
  const open = children.some((child) => child.active);
  if (collapsed || children.length === 0) {
    return <NavLink item={{ ...item, active: item.active || open }} collapsed={collapsed} />;
  }
  return (
    <Collapsible.Root defaultOpen={open}>
      <Collapsible.Trigger className={cn(ITEM, 'group cursor-pointer', open && 'text-fg')}>
        {item.icon}
        <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
        {item.badge === undefined ? null : <Badge tone="accent">{item.badge}</Badge>}
        <ChevronDown
          className="size-4 text-fg-muted transition-transform group-data-[panel-open]:rotate-180"
          aria-hidden
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        <ul className="mt-1 space-y-1 border-s border-line ms-5 ps-3">
          {children.map((child) => (
            <li key={child.href}>
              <NavLink item={child} collapsed={false} />
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function SideNav({
  nav,
  label,
  collapsed,
}: {
  nav: NavSection[];
  label: string;
  collapsed: boolean;
}) {
  return (
    <nav aria-label={label} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {nav.map((section, index) => (
        <div key={section.label ?? index} className="space-y-1">
          {section.label && !collapsed ? (
            <p className="px-3 pb-1 text-xs font-medium text-fg-muted">{section.label}</p>
          ) : null}
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavGroup item={item} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The panel layout: side menu, sticky header and the page (children). */
export function AppShell(props: AppShellProps) {
  const { brand, brandMark, nav, labels, headerStart, headerEnd, sidebarFooter, children } = props;
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-page">
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          'fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-line bg-sidebar transition-[width] lg:flex',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        <div
          className={cn(
            'flex h-header shrink-0 items-center border-b border-line',
            collapsed ? 'justify-center' : 'px-6',
          )}
        >
          {collapsed ? brandMark : brand}
        </div>
        <SideNav nav={nav} label={labels.nav} collapsed={collapsed} />
        {sidebarFooter && !collapsed ? (
          <div className="border-t border-line p-3">{sidebarFooter}</div>
        ) : null}
      </aside>

      <div
        className={cn(
          'flex min-h-dvh min-w-0 flex-col transition-[padding]',
          collapsed ? 'lg:ps-sidebar-collapsed' : 'lg:ps-sidebar',
        )}
      >
        <header className="sticky top-0 z-20 flex h-header shrink-0 items-center gap-2 border-b border-line bg-surface px-4 sm:px-6">
          <BaseDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <BaseDialog.Trigger
              aria-label={labels.openMenu}
              className={cn(buttonClasses('ghost', 'icon'), 'lg:hidden')}
            >
              <MenuIcon aria-hidden />
            </BaseDialog.Trigger>
            <SheetContent
              side="start"
              title={brand}
              closeLabel={labels.closeMenu}
              className="bg-sidebar"
            >
              <div className="-mx-5 -my-4 flex h-full flex-col">
                <SideNav nav={nav} label={labels.nav} collapsed={false} />
                {sidebarFooter ? (
                  <div className="border-t border-line p-3">{sidebarFooter}</div>
                ) : null}
              </div>
            </SheetContent>
          </BaseDialog.Root>
          <button
            type="button"
            aria-label={collapsed ? labels.expandMenu : labels.collapseMenu}
            aria-pressed={collapsed}
            onClick={() => setCollapsed((value) => !value)}
            className={cn(buttonClasses('ghost', 'icon'), 'max-lg:hidden')}
          >
            <DirectionalIcon>
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </DirectionalIcon>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">{headerStart}</div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">{headerEnd}</div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** The width-limited page area inside the shell. */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[90rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8', className)}
    >
      {children}
    </div>
  );
}

/** Title row of a page: breadcrumb, title, description and the page's actions (toolbar). */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {breadcrumb}
        <h1 className="text-xl font-semibold leading-snug text-fg">{title}</h1>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
