import type { ActorContext } from './actor-context';
import { parseCorrelationId } from './correlation-id';
import type { CorrelationId } from './correlation-id';
import { isMinted, mint } from './minted';
import type { Minted } from './minted';
import type { TenantContext } from './tenant-context';

/**
 * What every use case and facade method takes first (ADR-0001): the tenant, the actor and the
 * correlation id of one piece of work, as one minted value. It is built once by an entry
 * adapter (HTTP request, scheduled job, consumed event) and passed on unchanged: no code
 * replaces the actor of a context it received, and a context cannot be rebuilt from JSON or
 * copied with a spread.
 */
export interface CallContext extends Minted<'CallContext'> {
  readonly tenant: TenantContext;
  readonly actor: ActorContext;
  readonly correlationId: CorrelationId;
}

/** Why {@link createCallContext} refused its parts. */
export type ContextMismatchReason = 'not-minted' | 'tenant-mismatch';

/**
 * The parts of a context do not belong together: one was not minted, or the actor was
 * established in another tenant than the context's. The entry adapter turns it into a denial.
 */
export class ContextMismatchError extends Error {
  override readonly name = 'ContextMismatchError';
  constructor(readonly reason: ContextMismatchReason) {
    super(`The parts of the call context do not belong together: ${reason}`);
  }
}

/**
 * Mints the context of one piece of work. Called by the platform's entry adapters only, through
 * the `@phoenix/shared-kernel/contexts` entry. "An actor is valid only in its own tenant" is
 * enforced here, once.
 *
 * Throws {@link ContextMismatchError} when the tenant or the actor was not minted, or when the
 * actor's tenant is not the context's; a correlation id outside its pattern is a programmer
 * error and throws a TypeError.
 */
export function createCallContext<A extends ActorContext>(
  tenant: TenantContext,
  actor: A,
  correlationId: CorrelationId,
): CallContext & { readonly actor: A } {
  if (!isMinted(tenant) || !isMinted(actor)) throw new ContextMismatchError('not-minted');
  if (actor.tenantId !== tenant.tenantId) throw new ContextMismatchError('tenant-mismatch');
  if (!parseCorrelationId(correlationId).ok) {
    throw new TypeError('createCallContext: the correlation id must be a parsed value');
  }
  return mint<CallContext>({ tenant, actor, correlationId }) as CallContext & {
    readonly actor: A;
  };
}
