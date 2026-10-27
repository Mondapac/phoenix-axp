// Ported from Mondapac apps/api/src/platform/persistence/outbox/in-process-event-bus.ts, Market
// adapted to Tenant. The fan-out runs in the relay's transaction, which has already set
// `app.tenant_id` to the events' one tenant, so row-level security admits the delivery rows.
import type { Clock, DomainEvent } from '@phoenix/shared-kernel';
import type { EventBus, RelayTransaction } from '../../events/event-bus';
import type { SubscriptionRegistry } from '../../events/event-subscriptions';

/** The relay's transaction as this adapter uses it: the base client's raw statement. */
interface RawTransaction {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

const FAN_OUT = `
INSERT INTO "platform"."event_delivery" (
  "tenant_id", "event_id", "subscriber", "status", "attempts", "next_attempt_at",
  "type", "occurred_at", "aggregate_type", "aggregate_id", "aggregate_version",
  "correlation_id", "causation_id", "payload", "created_at")
VALUES ($1, $2::uuid, $3, 'pending', 0, $4::timestamptz, $5, $6::timestamptz, $7, $8::uuid,
        $9, $10, $11::uuid, $12::jsonb, $4::timestamptz)
ON CONFLICT ("tenant_id", "event_id", "subscriber") DO NOTHING`;

/**
 * The MVP adapter of the in-process bus (ADR-0006; platform persistence design, "P", 6.3 to 6.5).
 * It fans each event out to `platform.event_delivery`, one `pending` row per subscription of
 * its type, due now, with a copy of the envelope, through the relay's transaction: the delivery
 * rows and the mark of the outbox rows commit or roll back together. A repeated
 * `(tenant, event, subscriber)` is ignored. An event with no subscription writes nothing, and
 * an event published before a subscription existed is not delivered to it later.
 */
export class InProcessEventBus implements EventBus {
  constructor(
    private readonly subscriptions: SubscriptionRegistry,
    private readonly clock: Clock,
  ) {}

  async publish(events: readonly DomainEvent[], transaction: RelayTransaction): Promise<void> {
    const raw = transaction as unknown as RawTransaction;
    const now = new Date(this.clock.now().epochMilliseconds);
    for (const event of events) {
      for (const subscriber of this.subscriptions.subscribersOf(event.type)) {
        await raw.$executeRawUnsafe(
          FAN_OUT,
          event.tenant.tenantId,
          event.eventId,
          subscriber,
          now,
          event.type,
          new Date(event.occurredAt.epochMilliseconds),
          event.aggregateType,
          event.aggregateId,
          event.aggregateVersion,
          event.correlationId,
          event.causationId,
          JSON.stringify(event.payload),
        );
      }
    }
  }
}
