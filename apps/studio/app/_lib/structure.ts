// The view of the tenancy API on the structure screens (site tree and organization chart,
// ADR-0018): the shapes the API answers and the pure rules the screens build on. The API decides
// every change; these only order the trees and keep the screens from offering what it would
// refuse anyway. Shared by server and client modules.

export interface SiteNode {
  readonly id: string;
  readonly parentSiteId: string | null;
  readonly organizationId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly depth: number;
  readonly version: number;
}

export interface SiteDomain {
  readonly id: string;
  readonly siteId: string;
  readonly hostname: string;
  /** "" for the whole host, otherwise "/a/b". */
  readonly pathPrefix: string;
}

/** `GET tenancy/sites/:id`. */
export interface SiteView extends SiteNode {
  readonly domains: readonly SiteDomain[];
}

export interface OrganizationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly version: number;
}

/** Any node of a tree: its id and its parent's (null for a root). */
export interface TreeNode {
  readonly id: string;
  readonly parent: string | null;
}

export const siteNode = (site: SiteNode): TreeNode => ({ id: site.id, parent: site.parentSiteId });
export const organizationNode = (unit: OrganizationNode): TreeNode => ({
  id: unit.id,
  parent: unit.parentId,
});

/**
 * The nodes in tree order: each node right after its parent, siblings by name in the tenant's
 * collation. The API lists by depth; a node whose parent is not in the list (a subtree read)
 * starts a tree of its own.
 */
export function treeOrder<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  nodeOf: (item: T) => TreeNode,
  locale: string,
): T[] {
  const collator = new Intl.Collator(locale);
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const { parent } = nodeOf(item);
    const key = parent !== null && ids.has(parent) ? parent : null;
    const list = children.get(key);
    if (list === undefined) children.set(key, [item]);
    else list.push(item);
  }
  for (const list of children.values()) {
    list.sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
  }
  const ordered: T[] = [];
  const visit = (parent: string | null) => {
    for (const item of children.get(parent) ?? []) {
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  return ordered;
}

/** `id` and every node below it. */
export function subtreeIds<T>(
  items: readonly T[],
  nodeOf: (item: T) => TreeNode,
  id: string,
): ReadonlySet<string> {
  const found = new Set([id]);
  // Parents come before children in the API's depth order, but not always in another order:
  // repeat until nothing new joins.
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      const node = nodeOf(item);
      if (node.parent !== null && found.has(node.parent) && !found.has(node.id)) {
        found.add(node.id);
        grew = true;
      }
    }
  }
  return found;
}

/** The nodes `id` may move under: any node outside its own subtree. */
export function moveTargets<T>(
  items: readonly T[],
  nodeOf: (item: T) => TreeNode,
  id: string,
): T[] {
  const own = subtreeIds(items, nodeOf, id);
  return items.filter((item) => !own.has(nodeOf(item).id));
}

/** The direct children of `id`, in the order given. */
export function childrenOf<T>(items: readonly T[], nodeOf: (item: T) => TreeNode, id: string): T[] {
  return items.filter((item) => nodeOf(item).parent === id);
}

/** The ancestors of `id`, root first, without `id` itself; stops at a node not in the list. */
export function ancestorsOf<T>(
  items: readonly T[],
  nodeOf: (item: T) => TreeNode,
  id: string,
): T[] {
  const byId = new Map(items.map((item) => [nodeOf(item).id, item] as const));
  const path: T[] = [];
  const seen = new Set<string>([id]);
  let parent = byId.has(id) ? nodeOf(byId.get(id) as T).parent : null;
  while (parent !== null && !seen.has(parent)) {
    const item = byId.get(parent);
    if (item === undefined) break;
    path.unshift(item);
    seen.add(parent);
    parent = nodeOf(item).parent;
  }
  return path;
}

// The value rules of the tenancy API (modules/tenancy/domain/values.ts), repeated so a form can
// point at the field before sending. The API checks them again.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH_PREFIX = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export const MAX_SLUG_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;

export function isSlug(text: string): boolean {
  return text.length <= MAX_SLUG_LENGTH && SLUG.test(text);
}

export function isSiteName(text: string): boolean {
  const name = text.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && ![...name].some(isControl);
}

const isControl = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

/** A host name as the API stores it (lower case), or null when the API would refuse it. */
export function hostnameOf(text: string): string | null {
  const hostname = text.trim().toLowerCase();
  const labels = hostname.split('.');
  return hostname.length <= 253 && labels.length >= 2 && labels.every((l) => LABEL.test(l))
    ? hostname
    : null;
}

/** A path prefix as the API stores it ("" for the whole host), or null when it would refuse it. */
export function pathPrefixOf(text: string): string | null {
  const trimmed = text.trim();
  const prefix = trimmed === '/' ? '' : trimmed;
  return prefix.length <= 200 && PATH_PREFIX.test(prefix) ? prefix : null;
}

/** A domain as people read it: the host and its path. */
export function domainAddress(domain: Pick<SiteDomain, 'hostname' | 'pathPrefix'>): string {
  return `${domain.hostname}${domain.pathPrefix}`;
}

/** How far a tree row is indented: one step per level, no more than `MAX_INDENT` steps. */
export const MAX_INDENT = 8;
export function indentOf(depth: number): number {
  return Math.min(Math.max(0, depth), MAX_INDENT);
}

/** Whether a path parameter can be an id at all; anything else is simply not found. */
export function isId(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

/** The option value that stands for "no parent" in a parent picker; ids are UUIDs. */
export const ROOT_OPTION = 'root';
