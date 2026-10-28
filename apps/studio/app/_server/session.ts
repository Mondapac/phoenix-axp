import { heldKeys, type OwnPermissions } from '@phoenix/panel-server';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { messagesFor, type Messages } from '../_i18n/messages';
import { readApi, tenantPresentation, type TenantPresentation } from './panel';

// The signed-in member of this request: read from the API once per request (React's request
// cache, shared by the layout and the page) and never kept across requests (no session or
// permission cache, ADR-0004 decision 2). No live session goes to sign-in.

interface OwnAccount {
  readonly accountId: string;
  readonly username: string;
  readonly csrfToken: string;
}

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
}

export interface StudioSession {
  readonly accountId: string;
  readonly username: string;
  readonly csrfToken: string;
  readonly tenant: TenantPresentation;
  readonly t: Messages;
  /** Every key the member holds, tenant-wide or on some site: what the screens offer. */
  readonly held: ReadonlySet<string>;
  /** The sites the member may see, in tree order; empty without `tenancy.sites.view`. */
  readonly sites: readonly Site[];
}

export const studioSession = cache(async (): Promise<StudioSession> => {
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

  let sites: Site[] = [];
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
  return {
    accountId: me.body.accountId,
    username: me.body.username,
    csrfToken: me.body.csrfToken,
    tenant,
    t: messagesFor(tenant.defaultLocale),
    held,
    sites,
  };
});

/**
 * A page's read of the API. A missing resource is the not-found page; a lost session goes to
 * sign-in; a refusal is `null` (the page shows that the member has no access); anything else is
 * an error for the error page.
 */
export async function readForPage<T>(path: string): Promise<T | null> {
  const read = await readApi<T>(path);
  if (read.ok) return read.body;
  if (read.status === 404) notFound();
  if (read.status === 401) redirect('/sign-in');
  if (read.status === 403) return null;
  throw new Error(`${path} answered ${read.status}`);
}
