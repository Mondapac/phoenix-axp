// OpenID Connect Authorization Code + PKCE against the tenant's Keycloak realm (ADR-0004
// decision 1; one realm per tenant, owner decision P2). From the PoC 2 spike, which ported
// Mondapac's oidc-sign-in-providers.ts: no OIDC library, node:crypto verifies RS256 with the
// realm's published keys. The realm's public keys are the only thing kept between calls.
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { err, ok, type Clock, type Result, type TenantContext } from '@phoenix/shared-kernel';
import type { KeycloakConfig } from '../../../platform/config/app-config';
import type { SignInFlow } from '../application/sign-in-flow';
import type {
  ProviderFailure,
  ProviderIdentity,
  StaffIdentityProvider,
} from '../application/staff-identity-provider';

const REQUEST_TIMEOUT_MS = 5000;
const CLOCK_SKEW_SECONDS = 60;
const KEYS_TTL_MS = 60 * 60 * 1000;
/** A token with an unknown `kid` refetches the keys at most this often (key rotation). */
const KEYS_REFETCH_MS = 60 * 1000;
/** The longest subject and username the account table stores. */
const MAX_CLAIM_LENGTH = 255;

type Claims = Record<string, unknown>;
const isRecord = (value: unknown): value is Claims =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const decodeJson = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
};
const isClaimText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_CLAIM_LENGTH;

/** The issuer of a tenant's realm: `<url>/realms/<template with the tenant id>`. */
export function realmIssuer(config: KeycloakConfig, tenant: TenantContext): string {
  return `${config.url}/realms/${config.realmTemplate.replace('{tenant}', tenant.tenantId)}`;
}

export class KeycloakOidc implements StaffIdentityProvider {
  readonly #logger = new Logger('KeycloakOidc');
  /** Signing keys per realm issuer (public keys only). */
  readonly #keys = new Map<string, { keys: Map<string, KeyObject>; fetchedAt: number }>();

  constructor(
    private readonly config: KeycloakConfig,
    private readonly clock: Clock,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  authorizationUrl(tenant: TenantContext, flow: SignInFlow): string {
    const url = new URL(`${realmIssuer(this.config, tenant)}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.studioClientId,
      redirect_uri: this.config.studioCallbackUrl,
      scope: 'openid',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: flow.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange(
    tenant: TenantContext,
    code: string,
    flow: SignInFlow,
  ): Promise<Result<ProviderIdentity, ProviderFailure>> {
    const issuer = realmIssuer(this.config, tenant);
    const answer = await this.#request(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.studioCallbackUrl,
        client_id: this.config.studioClientId,
        client_secret: this.config.studioClientSecret,
        code_verifier: flow.codeVerifier,
      }).toString(),
    });
    if (!answer.ok) return answer;
    if (answer.value.status >= 500) return err('provider.unavailable');
    const body = answer.value.json;
    if (answer.value.status !== 200 || !isRecord(body) || typeof body.id_token !== 'string') {
      return this.#rejected(tenant, 'token-response');
    }
    // Only the ID token is used; the access and refresh tokens are dropped: the core keeps its
    // own session (ADR-0004 decision 2).
    const verified = await this.#verifyIdToken(tenant, body.id_token);
    if (!verified.ok) return verified;
    const claims = verified.value;
    if (claims.nonce !== flow.nonce) return this.#rejected(tenant, 'nonce');
    if (!isClaimText(claims.sub) || !isClaimText(claims.preferred_username)) {
      return this.#rejected(tenant, 'sub');
    }
    const directory = claims[this.config.directoryClaim];
    return ok({
      subject: claims.sub,
      username: claims.preferred_username.toLowerCase(),
      directory: typeof directory === 'string' && directory.length > 0,
      idpSessionId: isClaimText(claims.sid) ? claims.sid : null,
    });
  }

  /** RS256 signature by a realm key, `iss`, `aud`/`azp`, `exp` and `iat`. */
  async #verifyIdToken(
    tenant: TenantContext,
    token: string,
  ): Promise<Result<Claims, ProviderFailure>> {
    const parts = token.split('.');
    if (parts.length !== 3) return this.#rejected(tenant, 'format');
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    if (!isRecord(header) || !isRecord(claims)) return this.#rejected(tenant, 'format');
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      return this.#rejected(tenant, 'alg');
    }
    const issuer = realmIssuer(this.config, tenant);
    const key = await this.#key(issuer, header.kid);
    if (key === 'unavailable') return err('provider.unavailable');
    if (key === null) return this.#rejected(tenant, 'kid');
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'),
      key,
      Buffer.from(signaturePart, 'base64url'),
    );
    if (!signed) return this.#rejected(tenant, 'signature');
    const now = this.clock.now().epochMilliseconds / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const clientId = this.config.studioClientId;
    if (claims.iss !== issuer) return this.#rejected(tenant, 'iss');
    if (!audiences.includes(clientId)) return this.#rejected(tenant, 'aud');
    if (audiences.length > 1 && claims.azp !== clientId) return this.#rejected(tenant, 'azp');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) {
      return this.#rejected(tenant, 'exp');
    }
    if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) {
      return this.#rejected(tenant, 'iat');
    }
    return ok(claims);
  }

  #rejected(tenant: TenantContext, reason: string): Result<never, ProviderFailure> {
    this.#logger.warn({ msg: 'identity.token.rejected', reason, tenantId: tenant.tenantId });
    return err('provider.rejected');
  }

  async #key(issuer: string, kid: string): Promise<KeyObject | null | 'unavailable'> {
    const nowMs = this.clock.now().epochMilliseconds;
    const cached = this.#keys.get(issuer);
    const fresh = cached !== undefined && nowMs - cached.fetchedAt < KEYS_TTL_MS;
    if (fresh && cached.keys.has(kid)) return cached.keys.get(kid)!;
    if (fresh && nowMs - cached.fetchedAt < KEYS_REFETCH_MS) return null;
    const answer = await this.#request(`${issuer}/protocol/openid-connect/certs`, {
      method: 'GET',
    });
    if (!answer.ok || answer.value.status !== 200) return 'unavailable';
    const body = answer.value.json;
    if (!isRecord(body) || !Array.isArray(body.keys)) return 'unavailable';
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys as unknown[]) {
      if (!isRecord(jwk) || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
      if (jwk.use !== undefined && jwk.use !== 'sig') continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // A malformed key is skipped.
      }
    }
    this.#keys.set(issuer, { keys, fetchedAt: nowMs });
    return keys.get(kid) ?? null;
  }

  async #request(
    url: string,
    init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
  ): Promise<Result<{ status: number; json: unknown }, 'provider.unavailable'>> {
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
      return ok({ status: response.status, json });
    } catch {
      return err('provider.unavailable');
    }
  }
}

/** The provider while Keycloak is not configured (outside production): every sign-in fails. */
export class UnconfiguredIdentityProvider implements StaffIdentityProvider {
  authorizationUrl(): null {
    return null;
  }
  exchange(): Promise<Result<never, ProviderFailure>> {
    return Promise.resolve(err('provider.unavailable'));
  }
}
