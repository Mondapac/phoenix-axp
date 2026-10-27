// The staff directory sync's view of the tenant's users (ADR-0022 decision 6; PoC 2 verdict 5):
// Keycloak's admin API on the tenant's realm, read with the service-account client
// (`KEYCLOAK_ADMIN_CLIENT_ID`, realm-management `view-users` only). With LDAP federation in
// NO_CACHE mode Keycloak looks each user up in the directory, so a user disabled or removed in
// AD answers 404 or `enabled: false`.
import { Logger } from '@nestjs/common';
import { err, ok, type Clock, type Result, type TenantContext } from '@phoenix/shared-kernel';
import type { KeycloakConfig } from '../../../platform/config/app-config';
import type { StaffDirectory } from '../application/staff-directory';
import type { DirectoryStatus } from '../domain/directory-sync';
import { realmIssuer } from './keycloak-oidc';

const REQUEST_TIMEOUT_MS = 5000;
/** Lookups in flight at once per run: kind to Keycloak and to the directory behind it. */
const CONCURRENCY = 8;
/** A service-account token is reused until this long before it expires. */
const TOKEN_MARGIN_MS = 30_000;

type Unavailable = Result<never, 'directory.unavailable'>;
const UNAVAILABLE: Unavailable = err('directory.unavailable');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class KeycloakDirectory implements StaffDirectory {
  readonly #logger = new Logger('KeycloakDirectory');
  /** Service-account tokens per realm: credentials, kept in memory only and never logged. */
  readonly #tokens = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(
    private readonly config: KeycloakConfig,
    private readonly clock: Clock,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async statusOf(
    tenant: TenantContext,
    subjects: readonly string[],
  ): Promise<Result<ReadonlyMap<string, DirectoryStatus>, 'directory.unavailable'>> {
    const token = await this.#token(tenant);
    if (token === null) return UNAVAILABLE;
    const admin = realmIssuer(this.config, tenant).replace('/realms/', '/admin/realms/');
    const statuses = new Map<string, DirectoryStatus>();
    let failed = false;
    let next = 0;
    const worker = async () => {
      while (!failed && next < subjects.length) {
        const subject = subjects[next++]!;
        const status = await this.#statusOfOne(admin, token, subject);
        if (status === null) failed = true;
        else statuses.set(subject, status);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subjects.length) }, worker));
    if (failed) {
      this.#logger.warn({ msg: 'identity.directory.unavailable', tenantId: tenant.tenantId });
      return UNAVAILABLE;
    }
    return ok(statuses);
  }

  async #statusOfOne(
    admin: string,
    token: string,
    subject: string,
  ): Promise<DirectoryStatus | null> {
    const answer = await this.#request(`${admin}/users/${encodeURIComponent(subject)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (answer === null) return null;
    if (answer.status === 404) return 'missing';
    if (answer.status !== 200 || !isRecord(answer.json)) return null;
    if (answer.json.id !== subject || typeof answer.json.enabled !== 'boolean') return null;
    return answer.json.enabled ? 'enabled' : 'disabled';
  }

  /** A service-account token of the tenant's realm, or null when none can be had. */
  async #token(tenant: TenantContext): Promise<string | null> {
    const secret = this.config.adminClientSecret;
    if (secret === null) return null;
    const issuer = realmIssuer(this.config, tenant);
    const nowMs = this.clock.now().epochMilliseconds;
    const cached = this.#tokens.get(issuer);
    if (cached !== undefined && cached.expiresAtMs - TOKEN_MARGIN_MS > nowMs) return cached.token;
    const answer = await this.#request(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.adminClientId,
        client_secret: secret,
      }).toString(),
    });
    if (answer === null || answer.status !== 200 || !isRecord(answer.json)) return null;
    const { access_token: token, expires_in: expiresIn } = answer.json;
    if (typeof token !== 'string' || typeof expiresIn !== 'number') return null;
    this.#tokens.set(issuer, { token, expiresAtMs: nowMs + expiresIn * 1000 });
    return token;
  }

  async #request(
    url: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; json: unknown } | null> {
    try {
      const response = await this.fetchFn(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
      return { status: response.status, json };
    } catch {
      return null;
    }
  }
}

/** The directory while Keycloak or its admin client is not configured: never answers. */
export class UnconfiguredDirectory implements StaffDirectory {
  statusOf(): Promise<Unavailable> {
    return Promise.resolve(UNAVAILABLE);
  }
}
