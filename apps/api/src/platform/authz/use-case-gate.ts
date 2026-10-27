// Ported from Mondapac apps/api/src/platform/authz/use-case-gate.ts (identity design 5.2;
// platform-foundations 6.4), Market adapted to Tenant. Phoenix additions, both fail closed and
// both decided before the authorisation check is asked: under a `permissions` rule, a key the
// registry does not declare grants nothing (ADR-0004 decision 6), and every key must be of a
// scope the actor's population may hold, so a portal user is never admitted under a
// `permissions` rule (ADR-0019 decision 2).
import { Logger } from '@nestjs/common';
import { err, isMinted, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { anonymousActor, createCallContext } from '@phoenix/shared-kernel/contexts';
import type { TenantRegistry } from '../tenant-config/tenant-registry';
import { DENIED, UNAUTHENTICATED, UNAVAILABLE, type AccessDenied } from './access-denied';
import { accessDeclarationOf, type AccessDeclaration } from './access-rule';
import type { AccessDecision, AuthorisationCheck } from './authorisation-check';
import { populationOfScope } from './permission';
import type { SealedPermissionCatalogue } from './permission-registry';

/** Why the gate refused, for the log only. */
type DenialReason =
  | 'declaration-missing'
  | 'declaration-invalid'
  | 'context-not-minted'
  | 'tenant-not-hosted'
  | 'tenant-mismatch'
  | 'system-only'
  | 'system-actor-not-allowed'
  | 'authentication-required'
  | 'key-unknown'
  | 'population-mismatch'
  | 'check-unbound'
  | 'check-denied'
  | 'check-malformed'
  | 'gate-error';

class Denial {
  constructor(
    readonly reason: DenialReason,
    readonly answer: AccessDenied,
  ) {}
}

/** The key of the constructor: private to this file (M1). */
const CONSTRUCTION: unique symbol = Symbol('UseCaseGate.construction');
/** Every gate this file built. */
const gates = new WeakSet<object>();

/** The part of the permission registry the gate reads: the declaration of a key. */
export type GatePermissions = Pick<SealedPermissionCatalogue, 'get'>;

/** The check's answer, or a denial when it is not one of the shapes the port allows. */
function decisionOf(decision: AccessDecision): Denial | null {
  if (typeof decision !== 'object' || decision === null) {
    return new Denial('check-malformed', UNAVAILABLE);
  }
  if (decision.allowed === true) return null;
  if (decision.allowed !== false || typeof decision.denial !== 'object') {
    return new Denial('check-malformed', UNAVAILABLE);
  }
  switch (decision.denial.code) {
    case 'access.denied':
      return new Denial('check-denied', DENIED);
    case 'access.unavailable':
      return new Denial('check-denied', UNAVAILABLE);
    default:
      return new Denial('check-malformed', UNAVAILABLE);
  }
}

/**
 * The access-rule mechanism of `platform/authz` (Phoenix ADR-0004 decision 4).
 * `UseCase.execute` calls {@link admit} before `handle`, for every entry point: HTTP, jobs,
 * event handlers, facade calls and later AI tools. In order, it:
 *
 * 1. reads the declaration only as an own property of the use-case class (HF4);
 * 2. refuses a context that was not minted, and a tenant this deployment does not host;
 * 3. compares the actor's tenant with the context's;
 * 4. decides `system` and `anonymous` itself; under `anonymous` the use case always receives
 *    the tenant's anonymous actor, so nothing branches on a signed-in visitor (HF9);
 * 5. under `permissions`, refuses an unknown key and a key of a scope the actor's population
 *    may not hold (platform keys: `platform-operator`; tenant and site keys: `tenant-staff`;
 *    none for `portal-user`);
 * 6. for an authenticated actor under `permissions` or `own-resources`, asks the
 *    `AuthorisationCheck` port (identity).
 *
 * An exception inside the gate is a denial (`access.unavailable`). Every denial is logged with
 * the use-case name, the rule, the actor and its id, the tenant and the correlation id. The
 * gate opens no unit of work: the use-case body does that, after admission.
 *
 * Final: a subclass could replace the decision, so the constructor refuses one. Minted: the
 * constructor needs a key private to this file, so a gate exists only through
 * {@link createUseCaseGate}, which only `platform/authz/` may import (dependency-cruiser
 * `use-case-gate-is-built-by-authz`); `UseCase` accepts only a gate {@link isUseCaseGate}
 * recognises. A module never sees this class as a value: it injects `USE_CASE_GATE` and names
 * the type through the `platform/authz` barrel.
 */
export class UseCaseGate {
  readonly #logger = new Logger('UseCaseGate');
  readonly #tenants: TenantRegistry;
  readonly #permissions: GatePermissions;
  /**
   * The authorisation check. `null` only where a test builds a gate without one: every
   * authenticated actor is then refused with `access.unavailable`.
   */
  readonly #authorisation: AuthorisationCheck | null;

  constructor(
    key: typeof CONSTRUCTION,
    tenants: TenantRegistry,
    permissions: GatePermissions,
    authorisation: AuthorisationCheck | null,
  ) {
    if (new.target !== UseCaseGate) {
      throw new TypeError('UseCaseGate is final; it cannot be subclassed');
    }
    if (key !== CONSTRUCTION) {
      throw new TypeError('A UseCaseGate is built by platform/authz only');
    }
    this.#tenants = tenants;
    this.#permissions = permissions;
    this.#authorisation = authorisation;
    gates.add(this);
  }

  /**
   * Admits a call of `useCase` under `context`. Answers the context the use case must run
   * with (for `anonymous`, the tenant's anonymous actor), or the refusal.
   */
  async admit(useCase: unknown, context: CallContext): Promise<Result<CallContext, AccessDenied>> {
    let declaration: AccessDeclaration | null = null;
    try {
      const declared = accessDeclarationOf(useCase);
      if (!declared.ok) {
        return this.deny(
          null,
          context,
          new Denial(
            declared.error.code === 'declaration-missing'
              ? 'declaration-missing'
              : 'declaration-invalid',
            DENIED,
          ),
        );
      }
      declaration = declared.value;
      const decided = await this.decide(declaration, context);
      return decided instanceof Denial ? this.deny(declaration, context, decided) : ok(decided);
    } catch {
      return this.deny(declaration, context, new Denial('gate-error', UNAVAILABLE));
    }
  }

  private async decide(
    declaration: AccessDeclaration,
    context: CallContext,
  ): Promise<CallContext | Denial> {
    if (!isMinted(context) || !isMinted(context.tenant) || !isMinted(context.actor)) {
      return new Denial('context-not-minted', DENIED);
    }
    const { tenant, actor } = context;
    if (!this.#tenants.isHosted(tenant.tenantId)) return new Denial('tenant-not-hosted', DENIED);
    if (actor.tenantId !== tenant.tenantId) return new Denial('tenant-mismatch', DENIED);

    const { rule } = declaration;
    if (rule.kind === 'system') {
      return actor.kind === 'system' ? context : new Denial('system-only', DENIED);
    }
    if (actor.kind === 'system') return new Denial('system-actor-not-allowed', DENIED);
    if (rule.kind === 'anonymous') {
      return actor.kind === 'anonymous'
        ? context
        : createCallContext(tenant, anonymousActor(tenant), context.correlationId);
    }
    if (actor.kind === 'anonymous') return new Denial('authentication-required', UNAUTHENTICATED);
    if (rule.kind === 'permissions') {
      for (const key of rule.allOf) {
        const declared = this.#permissions.get(key);
        if (declared === undefined) return new Denial('key-unknown', DENIED);
        if (populationOfScope(declared.scope) !== actor.population) {
          return new Denial('population-mismatch', DENIED);
        }
      }
    }
    if (this.#authorisation === null) return new Denial('check-unbound', UNAVAILABLE);
    return decisionOf(await this.#authorisation.check(context, declaration)) ?? context;
  }

  private deny(
    declaration: AccessDeclaration | null,
    context: CallContext,
    denial: Denial,
  ): Result<never, AccessDenied> {
    try {
      const actor = isMinted(context) ? context.actor : undefined;
      const rule = declaration?.rule;
      this.#logger.warn({
        msg: 'access.denied',
        useCase: declaration?.name ?? null,
        rule: rule?.kind ?? null,
        ...(rule?.kind === 'permissions' ? { keys: [...rule.allOf] } : {}),
        actor: actor?.kind ?? null,
        actorId: actor?.kind === 'authenticated' ? actor.accountId : null,
        tenantId: isMinted(context) ? context.tenant.tenantId : null,
        correlationId: isMinted(context) ? context.correlationId : null,
        reason: denial.reason,
        code: denial.answer.code,
      });
    } catch {
      // A failure to log never turns a denial into an admission.
    }
    return err(denial.answer);
  }
}

/**
 * Builds a gate. Imported only by `platform/authz/` (the module's provider) and by tests; a
 * dependency-cruiser rule refuses every other importer of this file.
 */
export function createUseCaseGate(
  tenants: TenantRegistry,
  permissions: GatePermissions,
  authorisation: AuthorisationCheck | null,
): UseCaseGate {
  return new UseCaseGate(CONSTRUCTION, tenants, permissions, authorisation);
}

/** True only for a gate {@link createUseCaseGate} built: never a look-alike or a copy. */
export function isUseCaseGate(value: unknown): value is UseCaseGate {
  return typeof value === 'object' && value !== null && gates.has(value);
}
