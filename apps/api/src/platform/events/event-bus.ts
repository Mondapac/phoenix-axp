// Ported from Mondapac apps/api/src/platform/events/event-bus.ts. Phoenix: Market became Tenant,
// and `unhostedMarketsWithRows` is not ported: under row-level security (ADR-02) the
// application login sees only the rows of the tenant it sets, so it cannot list the rows of a
// tenant this deployment does not host; that is an operator query, as the migration role.
import type { DomainEvent } from '@phoenix/shared-kernel';

declare const relayTransaction: unique symbol;

/**
 * The relay's open transaction, as an opaque handle of `platform/persistence/` (platform
 * persistence design, "P", 6.3). The in-process adapter writes its delivery rows through it,
 * so fan-out and marking the outbox rows published are one transaction; a broker adapter
 * ignores it.
 */
export interface RelayTransaction {
  readonly [relayTransaction]: true;
}

/**
 * The swap point of Mondapac ADR-0006 decision 8 (P 6.3). Only the relay calls it, between claiming
 * outbox rows and marking them published; modules never see the bus.
 *
 * Delivery is at least once and in no particular order (P 6.2). An adapter that publishes
 * outside the relay's transaction (a broker) must tolerate a repeated `eventId`.
 */
export interface EventBus {
  publish(events: readonly DomainEvent[], transaction: RelayTransaction): Promise<void>;
}

/** Nest token of the {@link EventBus}. */
export const EVENT_BUS = Symbol('EVENT_BUS');

/** What one relay pass did (P 6.1): the number of events published and whether a batch was full. */
export interface RelayPass {
  readonly published: number;
  /** A full batch is followed by the next pass at once; otherwise the worker pauses. */
  readonly fullBatch: boolean;
}

/**
 * The relay of P 6.1, as the worker runs it: one pass over every module outbox of the model
 * map and every hosted tenant, one tenant per transaction. Implemented in
 * `platform/persistence/outbox/`.
 */
export interface OutboxRelay {
  runOnce(): Promise<RelayPass>;
}

/** Nest token of the {@link OutboxRelay}. */
export const OUTBOX_RELAY = Symbol('OUTBOX_RELAY');

/** Events per claim (P 6.1). */
export const RELAY_BATCH_SIZE = 50;
/** The pause after a pass with no full batch (P 6.1; Mondapac ADR-0006 targets under 1 s). */
export const RELAY_IDLE_PAUSE_MS = 500;
/** The age of the oldest claimed row above which the relay logs a lag line (P 6.2, PK3). */
export const RELAY_LAG_LOG_MS = 5000;
