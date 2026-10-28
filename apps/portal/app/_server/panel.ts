import {
  readFromApi,
  readPanelServerConfig,
  type ApiRead,
  type PanelServerConfig,
} from '@phoenix/panel-server';
import { headers } from 'next/headers';

// The portal's BFF configuration and its reads of the API for server components. Server code
// only (check-panel-boundaries): a client component never sees the API's address.

let config: PanelServerConfig | undefined;

/** Read on first use, so `next build` needs no environment; a bad setting fails the request. */
export function portalConfig(): PanelServerConfig {
  config ??= readPanelServerConfig(process.env, 'PORTAL_TENANT_HOSTS');
  return config;
}

/**
 * The API routes the portal's screens call through `/api/...`, as path prefixes (ADR-0026).
 * Anything else answers 404 at the BFF.
 */
export const PORTAL_API_PREFIXES: readonly (readonly string[])[] = [
  ['identity', 'portal', 'challenge'],
  ['identity', 'portal', 'code'],
  ['identity', 'portal', 'sign-in'],
  ['identity', 'portal', 'sign-out'],
];

/**
 * The anonymous routes of sign-in. The relay sends them no cookie: a stale or another
 * session's cookie must not make the API refuse the sign-in of a visitor (ADR-0026 decision 4).
 */
export const ANONYMOUS_API_PREFIXES: readonly (readonly string[])[] = [
  ['identity', 'portal', 'challenge'],
  ['identity', 'portal', 'code'],
  ['identity', 'portal', 'sign-in'],
];

/** Whether `segments` start with one of `prefixes`. */
export function startsWithAny(
  segments: readonly string[],
  prefixes: readonly (readonly string[])[],
): boolean {
  return prefixes.some(
    (prefix) => prefix.length > 0 && prefix.every((part, index) => segments[index] === part),
  );
}

/**
 * A GET of the API in the tenant of this request's host, with the browser's cookies; an
 * `anonymous` read sends none, so a stale session cookie cannot break the sign-in page.
 */
export async function readApi<T>(
  path: string,
  { anonymous = false }: { readonly anonymous?: boolean } = {},
): Promise<ApiRead<T>> {
  const incoming = await headers();
  return readFromApi<T>(
    portalConfig(),
    { host: incoming.get('host'), cookie: anonymous ? null : incoming.get('cookie') },
    path,
  );
}

/** How the portal presents the tenant (`GET /tenancy/presentation`). */
export interface TenantPresentation {
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly direction: 'ltr' | 'rtl';
  readonly calendar: string;
  readonly timeZone: string;
}

/** The request's tenant presentation; throws when the API cannot answer it. */
export async function tenantPresentation(): Promise<TenantPresentation> {
  const read = await readApi<TenantPresentation>('tenancy/presentation', { anonymous: true });
  if (!read.ok) throw new Error(`tenancy/presentation answered ${read.status}`);
  return read.body;
}
