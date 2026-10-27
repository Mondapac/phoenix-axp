// SPIKE (PoC 2): ported from Mondapac platform/authz/use-case-gate.ts, Market -> Tenant, seller
// states removed. The order of checks and the "an exception is a denial" rule are unchanged.
import { Logger } from '@nestjs/common';
import { err, isMinted, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { anonymousActor, createCallContext } from '@phoenix/shared-kernel/contexts';
import type { TenantRegistry } from '../tenant-config/tenant-registry';
import { DENIED, UNAUTHENTICATED, UNAVAILABLE, type AccessDenied } from './access-denied';
import { accessDeclarationOf, type AccessDeclaration } from './access-rule';
import type { AccessDecision, AuthorisationCheck } from './authorisation-check';

type DenialReason =
  | 'declaration-missing'
  | 'declaration-invalid'
  | 'context-not-minted'
  | 'tenant-not-hosted'
  | 'tenant-mismatch'
  | 'system-only'
  | 'system-actor-not-allowed'
  | 'authentication-required'
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

const CONSTRUCTION: unique symbol = Symbol('UseCaseGate.construction');
const gates = new WeakSet<object>();

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
 * The access-rule mechanism. `UseCase.execute` calls {@link admit} before `handle`, for every
 * entry point (HTTP, jobs, event handlers, facades, later AI tools). It reads the declaration
 * as an own property, refuses unminted contexts, tenants this deployment does not host and an
 * actor of another tenant, decides `system` and `anonymous` itself, and asks identity's
 * `AuthorisationCheck` for an authenticated actor. An exception is a denial.
 */
export class UseCaseGate {
  readonly #logger = new Logger('UseCaseGate');
  readonly #tenants: TenantRegistry;
  readonly #authorisation: AuthorisationCheck | null;

  constructor(
    key: typeof CONSTRUCTION,
    tenants: TenantRegistry,
    authorisation: AuthorisationCheck | null,
  ) {
    if (new.target !== UseCaseGate) throw new TypeError('UseCaseGate is final');
    if (key !== CONSTRUCTION) throw new TypeError('A UseCaseGate is built by platform/authz only');
    this.#tenants = tenants;
    this.#authorisation = authorisation;
    gates.add(this);
  }

  async admit(useCase: unknown, context: CallContext): Promise<Result<CallContext, AccessDenied>> {
    let declaration: AccessDeclaration | null = null;
    try {
      const declared = accessDeclarationOf(useCase);
      if (!declared.ok) {
        const reason =
          declared.error.code === 'declaration-missing'
            ? 'declaration-missing'
            : 'declaration-invalid';
        return this.deny(null, context, new Denial(reason, DENIED));
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
      this.#logger.warn({
        msg: 'access.denied',
        useCase: declaration?.name ?? null,
        rule: declaration?.rule.kind ?? null,
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

export function createUseCaseGate(
  tenants: TenantRegistry,
  authorisation: AuthorisationCheck | null,
): UseCaseGate {
  return new UseCaseGate(CONSTRUCTION, tenants, authorisation);
}

export function isUseCaseGate(value: unknown): value is UseCaseGate {
  return typeof value === 'object' && value !== null && gates.has(value);
}

export const USE_CASE_GATE = Symbol('USE_CASE_GATE');
