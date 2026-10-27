// Ported from Mondapac apps/api/test/db/outbox-support.ts, adapted to Phoenix: the events are
// those of the test-only `probe` module (prisma/schema/probe.prisma), whose outbox, inbox and
// receipt tables exist so the event path can be proven before a business module has events.
import { defineEvent, eventField, ok, Temporal } from '@phoenix/shared-kernel';
import type {
  CallContext,
  DomainEvent,
  Id,
  PendingEvent,
  TenantContext,
} from '@phoenix/shared-kernel';
import { testCallContext } from '@phoenix/shared-kernel/testing';
import { NO_PERMISSION_KEYS } from '../../src/platform/authz/permission-key-lookup';
import { SystemClock } from '../../src/platform/clock/system-clock';
import type { EventBus, RelayTransaction } from '../../src/platform/events/event-bus';
import { EventCatalogue } from '../../src/platform/events/event-catalogue';
import type { OutboxWriter } from '../../src/platform/events/outbox-writer';
import { UuidV7IdGenerator } from '../../src/platform/ids/uuid-v7-id-generator';
import { PrismaOutboxWriterFactory } from '../../src/platform/persistence/outbox/prisma-outbox-writer';
import { modelMap, type Persistence } from './persistence-support';

/** A test-only probe event with every field kind but `permissionKey`. */
export const thingRecorded = defineEvent({
  type: 'probe.thing-recorded.v1',
  aggregateType: 'probe-thing',
  payload: {
    thingId: eventField.id(),
    state: eventField.enumOf(['open', 'closed'] as const),
    count: eventField.integer(),
    flagged: eventField.boolean(),
    at: eventField.instant(),
    related: eventField.listOf(eventField.id()),
    parentId: eventField.optional(eventField.id()),
  },
});

export const ids = new UuidV7IdGenerator(new SystemClock());
export const OCCURRED_AT = Temporal.Instant.from('2026-10-27T01:02:03.004Z');

export function testCatalogue(): EventCatalogue {
  const catalogue = new EventCatalogue();
  catalogue.register('probe', [thingRecorded]);
  catalogue.seal();
  return catalogue;
}

/** The probe writer of one test process, as `PersistenceModule.outboxWriterFor('probe')` binds it. */
export function probeWriter(db: Persistence, catalogue = testCatalogue()): OutboxWriter {
  return new PrismaOutboxWriterFactory(
    modelMap,
    db.service,
    catalogue,
    ids,
    NO_PERMISSION_KEYS,
  ).forModule('probe');
}

/** A minted CallContext for the writer: the tenant's system actor and a fresh correlation id. */
export function eventContext(tenant: TenantContext): CallContext {
  return testCallContext(tenant, 'system', `db-test-${ids.next()}`);
}

/** A valid PendingEvent of {@link thingRecorded} for a new aggregate. */
export function thing(
  version = 1,
  thingId: Id = ids.next(),
  overrides: Partial<PendingEvent> = {},
): PendingEvent {
  return {
    ...thingRecorded.record({
      aggregateId: thingId,
      aggregateVersion: version,
      occurredAt: OCCURRED_AT,
      payload: {
        thingId,
        state: 'open',
        count: 2,
        flagged: false,
        at: OCCURRED_AT,
        related: [],
        parentId: null,
      },
    }),
    ...overrides,
  };
}

/** Writes events in one read-write unit of `context.tenant`, as a use case does. */
export async function writeEvents(
  db: Persistence,
  writer: OutboxWriter,
  context: CallContext,
  events: readonly PendingEvent[],
): Promise<void> {
  await db.unitOfWork.run(context.tenant, async () => {
    await writer.append(context, events);
    return ok(undefined);
  });
}

/** A bus that records what it is given, then hands the events on (P 13). */
export class RecordingBus implements EventBus {
  readonly published: DomainEvent[] = [];

  constructor(private readonly next?: EventBus) {}

  async publish(events: readonly DomainEvent[], transaction: RelayTransaction): Promise<void> {
    this.published.push(...events);
    await this.next?.publish(events, transaction);
  }
}
