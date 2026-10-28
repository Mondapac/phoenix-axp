import { parseTenantId } from '@phoenix/shared-kernel';

// The configuration of a panel's BFF, from its environment (.env.example). There is no default:
// a panel that names no API or hosts no tenant refuses to start (ADR-0002, no default tenant).

/** A panel's BFF configuration. */
export interface PanelServerConfig {
  /** The core API's base URL, reachable from the panel's server only. */
  readonly apiUrl: URL;
  /** The panel's hosts (`host` or `host:port`, lower case) and the tenant each one serves. */
  readonly tenantHosts: ReadonlyMap<string, string>;
}

/** A missing or malformed setting: the panel does not start. */
export class PanelConfigError extends Error {
  override readonly name = 'PanelConfigError';
}

const HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/**
 * Reads `PHOENIX_API_URL` and the panel's host map (for example `STUDIO_TENANT_HOSTS`):
 * comma-separated `host=tenant` pairs, such as `studio.fa.example.ir=demo-fa`. A host appears
 * once; several hosts may serve one tenant.
 */
export function readPanelServerConfig(
  env: Readonly<Record<string, string | undefined>>,
  hostsVariable: string,
): PanelServerConfig {
  return {
    apiUrl: parseApiUrl(env.PHOENIX_API_URL),
    tenantHosts: parseTenantHosts(env[hostsVariable], hostsVariable),
  };
}

function parseApiUrl(text: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(text ?? '');
  } catch {
    throw new PanelConfigError('PHOENIX_API_URL must be an absolute http or https URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new PanelConfigError(
      'PHOENIX_API_URL must be an http or https URL without credentials, query or fragment',
    );
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

/** The host map of `text`; refuses an empty map, a malformed pair and a host named twice. */
export function parseTenantHosts(
  text: string | undefined,
  variable: string,
): ReadonlyMap<string, string> {
  const hosts = new Map<string, string>();
  for (const pair of (text ?? '').split(',')) {
    if (pair.trim() === '') continue;
    const [rawHost, rawTenant, ...rest] = pair.split('=');
    const host = rawHost?.trim().toLowerCase() ?? '';
    const tenant = rawTenant?.trim() ?? '';
    if (rest.length > 0 || !HOST.test(host) || !parseTenantId(tenant).ok) {
      throw new PanelConfigError(`${variable} has a malformed host=tenant pair`);
    }
    if (hosts.has(host)) throw new PanelConfigError(`${variable} names a host twice`);
    hosts.set(host, tenant);
  }
  if (hosts.size === 0) throw new PanelConfigError(`${variable} must name at least one host`);
  return hosts;
}

/**
 * The tenant a request's `Host` header names, or null for a host the panel does not serve.
 * Only `Host` counts: `X-Forwarded-Host` and the like come from the client unless a proxy
 * rewrites them, so a reverse proxy in front of the panel must pass the original Host.
 */
export function tenantOfHost(config: PanelServerConfig, host: string | null): string | null {
  if (host === null) return null;
  return config.tenantHosts.get(host.trim().toLowerCase()) ?? null;
}
