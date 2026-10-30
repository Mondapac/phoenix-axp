import {
  readFromApi,
  readPanelServerConfig,
  type ApiRead,
  type PanelServerConfig,
} from '@phoenix/panel-server';
import { headers } from 'next/headers';

// The studio's BFF configuration and its reads of the API for server components. Server code
// only (check-panel-boundaries): a client component never sees the API's address.

let config: PanelServerConfig | undefined;

/** Read on first use, so `next build` needs no environment; a bad setting fails the request. */
export function studioConfig(): PanelServerConfig {
  config ??= readPanelServerConfig(process.env, 'STUDIO_TENANT_HOSTS');
  return config;
}

/**
 * The API routes the studio's screens call through `/api/...`, as path prefixes. Anything
 * else answers 404 at the BFF. Staff sign-in has its own routes under `/auth`.
 */
export const STUDIO_API_PREFIXES: readonly (readonly string[])[] = [
  ['identity', 'staff', 'me'],
  ['identity', 'staff', 'sign-out'],
  ['identity', 'staff-accounts'],
  ['identity', 'roles'],
  ['identity', 'permissions'],
  ['identity', 'role-assignments'],
  ['identity', 'directory-sync'],
  ['tenancy', 'sites'],
  ['tenancy', 'site-domains'],
  ['tenancy', 'organizations'],
  ['objects', 'definitions'],
  ['objects', 'revisions'],
  ['objects', 'o'],
];

/** Where sign-in sends the browser. */
export const SIGN_IN_PAGES = { signedIn: '/', signIn: '/sign-in' } as const;

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
    studioConfig(),
    { host: incoming.get('host'), cookie: anonymous ? null : incoming.get('cookie') },
    path,
  );
}

/** How the studio presents the tenant (`GET /tenancy/presentation`). */
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
