// SPIKE (PoC 2): the core's service account in each tenant realm (client `phoenix-core-admin`,
// realm-management view-users + manage-users): reads an account's state for the sync, and
// disables a local account. Keycloak's own user cache is off for the LDAP provider
// (cachePolicy NO_CACHE), so a read reflects the directory now.
import { Inject, Injectable } from '@nestjs/common';
import { err, ok, type Clock, type Result, type TenantContext } from '@phoenix/shared-kernel';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { IdpAccount, StaffDirectoryAdmin } from '../application/ports/staff-identity-provider';
import { IDENTITY_CONFIG, realmIssuer, type IdentityConfig } from './identity-config';

const TIMEOUT_MS = 5000;

@Injectable()
export class KeycloakAdmin implements StaffDirectoryAdmin {
  /** Service-account access tokens per realm, until shortly before they expire. */
  readonly #tokens = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  #adminBase(tenant: TenantContext): string {
    return `${this.config.keycloakUrl}/admin/realms/phoenix-${tenant.tenantId}`;
  }

  async #token(tenant: TenantContext): Promise<string> {
    const nowMs = this.clock.now().epochMilliseconds;
    const cached = this.#tokens.get(tenant.tenantId);
    if (cached !== undefined && cached.expiresAtMs > nowMs) return cached.token;
    const response = await fetch(
      `${realmIssuer(this.config, tenant)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.adminClientId,
          client_secret: this.config.adminClientSecret,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`service account token: ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.#tokens.set(tenant.tenantId, {
      token: body.access_token,
      expiresAtMs: nowMs + (body.expires_in - 30) * 1000,
    });
    return body.access_token;
  }

  async account(
    tenant: TenantContext,
    subject: string,
  ): Promise<Result<IdpAccount, 'idp.unavailable'>> {
    try {
      const response = await fetch(
        `${this.#adminBase(tenant)}/users/${encodeURIComponent(subject)}`,
        {
          headers: { authorization: `Bearer ${await this.#token(tenant)}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (response.status === 404) return ok({ exists: false, enabled: false, directory: false });
      if (!response.ok) return err('idp.unavailable');
      const user = (await response.json()) as { enabled?: boolean; federationLink?: string };
      return ok({
        exists: true,
        enabled: user.enabled === true,
        directory: typeof user.federationLink === 'string',
      });
    } catch {
      return err('idp.unavailable');
    }
  }

  async disableLocal(
    tenant: TenantContext,
    subject: string,
  ): Promise<Result<void, 'idp.unavailable'>> {
    try {
      const headers = {
        authorization: `Bearer ${await this.#token(tenant)}`,
        'content-type': 'application/json',
      };
      const base = `${this.#adminBase(tenant)}/users/${encodeURIComponent(subject)}`;
      const disabled = await fetch(base, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Ends the user's Keycloak sessions (and sends back-channel logout to the clients).
      const loggedOut = await fetch(`${base}/logout`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return disabled.ok && loggedOut.ok ? ok(undefined) : err('idp.unavailable');
    } catch {
      return err('idp.unavailable');
    }
  }
}
