// SPIKE (PoC 2): identity's settings. In Phase 1 these join AppConfig and tenant configuration
// (realm per tenant, allowed staff sources); here they come from the environment.
import { randomBytes } from 'node:crypto';
import type { TenantContext } from '@phoenix/shared-kernel';

export interface IdentityConfig {
  /** Keycloak's base URL, e.g. http://127.0.0.1:8181 */
  readonly keycloakUrl: string;
  /** The core's public base URL (the redirect URI is under it). */
  readonly corePublicUrl: string;
  readonly studioClientId: string;
  readonly studioClientSecret: string;
  readonly adminClientId: string;
  readonly adminClientSecret: string;
  /** Key of the sign-in flow derivation; random per process when unset. */
  readonly flowKey: Buffer;
  readonly sessionHours: number;
}

export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

export function identityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required by the identity spike`);
    return value;
  };
  return {
    keycloakUrl: required('KEYCLOAK_URL').replace(/\/$/, ''),
    corePublicUrl: required('CORE_PUBLIC_URL').replace(/\/$/, ''),
    studioClientId: env.KEYCLOAK_STUDIO_CLIENT_ID ?? 'phoenix-studio',
    studioClientSecret: required('KEYCLOAK_STUDIO_CLIENT_SECRET'),
    adminClientId: env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'phoenix-core-admin',
    adminClientSecret: required('KEYCLOAK_ADMIN_CLIENT_SECRET'),
    flowKey: env.SIGN_IN_FLOW_KEY
      ? Buffer.from(env.SIGN_IN_FLOW_KEY, 'base64url')
      : randomBytes(32),
    sessionHours: Number(env.STUDIO_SESSION_HOURS ?? 8),
  };
}

/** One realm per tenant: `phoenix-<tenant id>`. */
export function realmIssuer(config: IdentityConfig, tenant: TenantContext): string {
  return `${config.keycloakUrl}/realms/phoenix-${tenant.tenantId}`;
}
