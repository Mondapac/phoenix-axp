import { redirect } from 'next/navigation';
import { messagesFor, type Messages } from '../_i18n/messages';
import { readApi, tenantPresentation, type TenantPresentation } from './panel';

// The signed-in portal user of this request, read from the API on every request (no session
// cache, ADR-0004 decision 2). No live session goes to sign-in.

export interface PortalContact {
  readonly method: 'email' | 'mobile';
  /** Enough of the address to recognise it; null when it cannot be opened (erased key). */
  readonly masked: string | null;
}

interface OwnAccount {
  readonly accountId: string;
  readonly contacts: readonly PortalContact[];
  readonly csrfToken: string;
}

export interface PortalSession extends OwnAccount {
  readonly tenant: TenantPresentation;
  readonly t: Messages;
}

export async function portalSession(): Promise<PortalSession> {
  const me = await readApi<OwnAccount>('identity/portal/me');
  // 404: the session's account is not a portal account of this tenant.
  if (me.status === 401 || me.status === 403 || me.status === 404) redirect('/sign-in');
  if (!me.ok) throw new Error(`identity/portal/me answered ${me.status}`);
  const tenant = await tenantPresentation();
  return { ...me.body, tenant, t: messagesFor(tenant.defaultLocale) };
}
