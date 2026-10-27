// Ported from Mondapac apps/api/src/platform/events/outbox-writer.ts, Market adapted to Tenant.
// The permission-key lookup moved to platform/authz/permission-key-lookup.ts, next to the
// registry that implements it.
import type { CallContext, Id, PendingEvent } from '@phoenix/shared-kernel';

/**
 * Writes the events of one module into its own outbox, in the open read-write unit of the
 * state change (P 5.2; Mondapac ADR-0006 decision 2). The use case calls it inside `work`, after its
 * repository saved the aggregate, with the `CallContext` it received (foundations 5.2 rule 2).
 *
 * It stamps the event id (`IdGenerator`), the tenant and the correlation id (the
 * context, never the aggregate's or the caller's data), and the causation id (`causedBy`, or
 * `null`); see P 5.1. The actor is not written: an event has no actor field (Mondapac ADR-0018 decision
 * 4). It throws, so that the unit rolls back and an event is never dropped silently, when: the
 * context was not minted; no unit is open, or the unit is read-only; the context's tenant is
 * not the unit's; a type is not this module's or not in the event catalogue; an aggregate type,
 * id or version (1 to 2^31 - 1) is malformed; the payload does not match its definition.
 */
export interface OutboxWriter {
  append(context: CallContext, events: readonly PendingEvent[], causedBy?: Id): Promise<void>;
}

/** Binds an {@link OutboxWriter} to one module's outbox (P 5.2). */
export interface OutboxWriterFactory {
  forModule(module: string): OutboxWriter;
}

/**
 * Nest token of a module's own {@link OutboxWriter}. A module binds it with
 * `PersistenceModule.outboxWriterFor` and never exports it. There is deliberately
 * no token of the {@link OutboxWriterFactory}: an injectable factory would let any module ask
 * for another module's writer (security review of slice 1b, M1).
 */
export const OUTBOX_WRITER = Symbol('OUTBOX_WRITER');

/** Why the outbox writer refused (P 5.2). Codes and, for a payload, the declared field name. */
export type OutboxRefusal =
  | 'context-not-minted'
  | 'read-only-unit'
  | 'correlation-id-invalid'
  | 'causation-id-invalid'
  | 'type-of-another-module'
  | 'type-not-in-catalogue'
  | 'aggregate-type-mismatch'
  | 'aggregate-id-invalid'
  | 'version-out-of-range'
  | 'occurred-at-invalid'
  | 'payload-invalid';

/**
 * The outbox writer refused an event or a call (P 5.2). It carries the reason and, for a
 * payload, the declared field name: never a value.
 */
export class OutboxWriteRefusedError extends Error {
  override readonly name = 'OutboxWriteRefusedError';
  constructor(
    readonly reason: OutboxRefusal,
    readonly field: string | null = null,
  ) {
    super(`The outbox writer refused: ${reason}${field === null ? '' : ` (${field})`}`);
  }
}
