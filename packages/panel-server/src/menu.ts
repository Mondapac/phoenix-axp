// The panel menu is data (ADR-0016 decision 3, ADR-0023): each panel declares its entries with
// the permission keys that show them, and the shell shows the entries the signed-in member
// holds a key of. A display aid only: hiding an entry protects nothing, the API's gate does.

/** One entry of a panel's menu declaration. */
export interface MenuEntry {
  readonly href: string;
  /** The message key of the label, resolved by the panel in the tenant's language. */
  readonly label: string;
  /** The panel's icon name. */
  readonly icon?: string;
  /** Shown when the member holds any of these keys; an empty list shows it to every member. */
  readonly anyOf: readonly string[];
  readonly children?: readonly MenuEntry[];
}

/** A visible entry, with whether it is the current page. */
export interface VisibleMenuEntry {
  readonly href: string;
  readonly label: string;
  readonly icon?: string;
  readonly active: boolean;
  readonly children: readonly VisibleMenuEntry[];
}

/** The member's permission keys as `GET /identity/staff/me/permissions` answers them. */
export interface OwnPermissions {
  readonly tenant: readonly string[];
  readonly sites: readonly { readonly keys: readonly string[] }[];
}

/** Every key the member holds, tenant-wide or on some site. */
export function heldKeys(permissions: OwnPermissions): ReadonlySet<string> {
  return new Set([...permissions.tenant, ...permissions.sites.flatMap((site) => site.keys)]);
}

function isCurrent(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The entries of `menu` the member may see, in declaration order. A parent shows when it is
 * allowed and keeps its allowed children; a parent whose children are all hidden is hidden.
 */
export function visibleMenu(
  menu: readonly MenuEntry[],
  held: ReadonlySet<string>,
  pathname: string,
): VisibleMenuEntry[] {
  const visible: VisibleMenuEntry[] = [];
  for (const entry of menu) {
    if (entry.anyOf.length > 0 && !entry.anyOf.some((key) => held.has(key))) continue;
    const children = visibleMenu(entry.children ?? [], held, pathname);
    if ((entry.children?.length ?? 0) > 0 && children.length === 0) continue;
    visible.push({
      href: entry.href,
      label: entry.label,
      ...(entry.icon === undefined ? {} : { icon: entry.icon }),
      active: isCurrent(entry.href, pathname),
      children,
    });
  }
  return visible;
}
