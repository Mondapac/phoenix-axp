import { parseId } from './id';
import type { Id } from './id';
import { isMinted, mint } from './minted';
import type { Minted } from './minted';
import type { TenantContext, TenantId } from './tenant-context';

/**
 * Who is acting, as identifiers (ADR-0001, ADR-0004). A closed union on `kind`: anonymous is an
 * explicit value, never `undefined` or `null`, and no kind is a default. Every kind carries the
 * tenant it was established in. Roles, permissions, an email, a name, a token, an address or a
 * user agent never travel in it: the identity module reads them on each check.
 *
 * All three kinds are minted. The anonymous and system actors are built by the platform's
 * entry adapters through the `@phoenix/shared-kernel/contexts` entry; the authenticated actor
 * only by identity's `Authenticator` (Phase 1), through the `/authenticated-actor` entry.
 */
export type ActorContext = AnonymousActor | SystemActor | AuthenticatedActor;

/** A request with no session, in its tenant. */
export interface AnonymousActor extends Minted<'AnonymousActor'> {
  readonly kind: 'anonymous';
  readonly tenantId: TenantId;
}

/** A job, a consumed event or a platform routine of one tenant. It has no account id. */
export interface SystemActor extends Minted<'SystemActor'> {
  readonly kind: 'system';
  readonly tenantId: TenantId;
}

/**
 * The three populations of the platform (Phase 0 mapping): each has its own sign-in and
 * session. A population fixes the scope of the permissions an actor may hold and grants
 * nothing by itself.
 */
export const POPULATIONS = ['platform-operator', 'tenant-staff', 'portal-user'] as const;
export type Population = (typeof POPULATIONS)[number];

/** A person signed in through a valid session. */
export interface AuthenticatedActor extends Minted<'AuthenticatedActor'> {
  readonly kind: 'authenticated';
  /** The tenant of the account and of the session. */
  readonly tenantId: TenantId;
  readonly population: Population;
  readonly accountId: Id<'Account'>;
  /** An id, never the token. */
  readonly sessionId: Id<'Session'>;
}

/** The fields of an authenticated actor other than its kind and tenant. */
export type AuthenticatedActorFields = Pick<
  AuthenticatedActor,
  'population' | 'accountId' | 'sessionId'
>;

function tenantOf(tenant: TenantContext, constructor: string): TenantId {
  if (!isMinted(tenant)) {
    throw new TypeError(`${constructor}: the TenantContext was not minted`);
  }
  return tenant.tenantId;
}

/** The anonymous actor of a tenant. Called by the platform's entry adapters only. */
export function anonymousActor(tenant: TenantContext): AnonymousActor {
  return mint<AnonymousActor>({ kind: 'anonymous', tenantId: tenantOf(tenant, 'anonymousActor') });
}

/** The system actor of a tenant. Called by the platform's entry adapters only. */
export function systemActor(tenant: TenantContext): SystemActor {
  return mint<SystemActor>({ kind: 'system', tenantId: tenantOf(tenant, 'systemActor') });
}

/**
 * Exported as `authenticatedActor` on the `@phoenix/shared-kernel/authenticated-actor` entry,
 * for the one file of identity that builds actors from a session, and called by the
 * `/testing` builders. Every field is checked again at run time: the brands are compile-time
 * only. Only the declared fields are copied.
 */
export function mintAuthenticatedActor(
  tenant: TenantContext,
  fields: AuthenticatedActorFields,
): AuthenticatedActor {
  const tenantId = tenantOf(tenant, 'authenticatedActor');
  const { population, accountId, sessionId } = fields;
  if (!(POPULATIONS as readonly unknown[]).includes(population)) {
    throw new TypeError('authenticatedActor: unknown population');
  }
  if (!parseId(accountId).ok || !parseId(sessionId).ok) {
    throw new TypeError('authenticatedActor: the account id and session id must be parsed ids');
  }
  return mint<AuthenticatedActor>({
    kind: 'authenticated',
    tenantId,
    population,
    accountId,
    sessionId,
  });
}
