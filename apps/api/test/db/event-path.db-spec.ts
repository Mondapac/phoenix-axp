import { Logger } from '@nestjs/common';
import { ok, Temporal } from '@phoenix/shared-kernel';
import type { CallContext } from '@phoenix/shared-kernel';
import { FixedClock } from '@phoenix/shared-kernel/testing';
import { Client } from 'pg';
import type { EventDelivery } from '../../src/platform/events/event-delivery';
import {
  subscription,
  SubscriptionRegistry,
  type SubscriberContext,
} from '../../src/platform/events/event-subscriptions';
import type { TenantConfig } from '../../src/platform/tenant-config/tenant-config';
import { TenantRegistry } from '../../src/platform/tenant-config/tenant-registry';
import { TenantContextFactory } from '../../src/platform/tenant-context/tenant-context.factory';
import { UnknownDeliveryError } from '../../src/platform/persistence/outbox/delivery-ledger';
import { InProcessEventBus } from '../../src/platform/persistence/outbox/in-process-event-bus';
import { PrismaEventDispatcher } from '../../src/platform/persistence/outbox/prisma-event-dispatcher';
import { PrismaOutboxRelay } from '../../src/platform/persistence/outbox/prisma-outbox-relay';
import { testTenantId, TEST_TENANTS } from '../support/test-config';
import {
  eventContext,
  probeWriter,
  RecordingBus,
  thing,
  thingRecorded,
  writeEvents,
} from './outbox-support';
import {
  createPersistence,
  modelMap,
  otherTenantOf,
  tenantOf,
  type Persistence,
} from './persistence-support';
import { deliveryOwnerTestDatabaseUrl, deliveryTestDatabaseUrl } from './test-database';

// The Phase 1 event path end to end, against PostgreSQL as the application login (slice 1.2):
// a use case appends to its module's outbox inside its unit; the relay claims the rows of each
// hosted tenant (`FOR UPDATE SKIP LOCKED`) in a transaction that sets that tenant, and the
// in-process bus fans them out to `platform.event_delivery` in the same transaction; the
// dispatcher claims due deliveries per tenant and runs the subscription as that tenant's system
// actor; the handler's use case opens `UnitOfWork.runOnce`, which records the module inbox row,
// does the work and marks the delivery delivered in one transaction. Delivery is at least once:
// a republished outbox row and a re-dispatched delivery both reach the work exactly once. Runs
// on its own copy of the run database (global-setup.ts), as Mondapac's event-delivery spec did.

interface Handled {
  readonly eventId: string;
  readonly tenantId: string;
  readonly context: SubscriberContext;
  readonly handled: boolean;
}

describe('event path: publish, relay, consume (database integration)', () => {
  let db: Persistence;
  let owner: Client;
  let app: Client;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db = createPersistence({ databaseUrl: deliveryTestDatabaseUrl() });
    owner = new Client({ connectionString: deliveryOwnerTestDatabaseUrl() });
    app = new Client({ connectionString: deliveryTestDatabaseUrl() });
    await owner.connect();
    await app.connect();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.end();
    await owner.end();
    await db.close();
  });

  // Every test starts with nothing due: what an earlier test left is set aside (as the owner;
  // FORCE ROW LEVEL SECURITY is lifted on this copy, global-setup.ts).
  afterEach(async () => {
    await owner.query(`UPDATE probe.outbox SET published_at = now() WHERE published_at IS NULL`);
    await owner.query(
      `UPDATE platform.event_delivery SET status = 'dead', dead_at = now(), error_code = 'test.set-aside'
        WHERE status = 'pending'`,
    );
  });

  /** A subscription whose handler records each call; `throwOnce` fails its first call. */
  function receiptHandler(options: { throwOnce?: boolean } = {}) {
    const handled: Handled[] = [];
    let failures = options.throwOnce === true ? 1 : 0;
    const entry = subscription({
      name: 'probe.record-receipt',
      event: thingRecorded,
      handle: async (event, delivery: EventDelivery, context) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('handler down');
        }
        const result = await db.unitOfWork.runOnce(context.tenant, delivery, async () => {
          await db.service.tx(context.tenant).probeReceipt.create({
            data: {
              tenantId: context.tenant.tenantId,
              eventId: event.eventId,
              thingId: event.payload.thingId,
              receivedAt: new Date(),
            },
          });
          return ok(undefined);
        });
        handled.push({
          eventId: event.eventId,
          tenantId: event.tenant.tenantId,
          context,
          handled: result.ok && result.value.handled,
        });
      },
    });
    return { entry, handled };
  }

  function stackOf(handler: ReturnType<typeof receiptHandler>, clock: FixedClock) {
    const registry = new SubscriptionRegistry();
    registry.register('probe', [handler.entry]);
    registry.seal();
    const tenants = new TenantRegistry(
      new Map(TEST_TENANTS.map((code) => [testTenantId(code), {} as TenantConfig] as const)),
    );
    const contexts = new TenantContextFactory(tenants);
    const bus = new RecordingBus(new InProcessEventBus(registry, clock));
    return {
      bus,
      relay: new PrismaOutboxRelay(db.root, modelMap, tenants, contexts, bus, clock),
      dispatcher: new PrismaEventDispatcher(db.root, tenants, contexts, registry, clock),
    };
  }

  const startClock = () => new FixedClock(Temporal.Now.instant());

  async function writeThings(code: string, count: number): Promise<CallContext> {
    const context = eventContext(tenantOf(code));
    await writeEvents(
      db,
      probeWriter(db),
      context,
      Array.from({ length: count }, () => thing()),
    );
    return context;
  }

  /** The rows of `sql` that the application login sees with `tenantId` set. */
  async function asTenant<R extends Record<string, unknown>>(
    tenantId: string,
    sql: string,
    values: unknown[] = [],
  ): Promise<R[]> {
    await app.query('BEGIN');
    try {
      await app.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantId]);
      return (await app.query<R>(sql, values)).rows;
    } finally {
      await app.query('ROLLBACK');
    }
  }

  async function deliveriesOf(eventIds: readonly string[]) {
    const { rows } = await owner.query<{
      tenant_id: string;
      event_id: string;
      status: string;
      attempts: number;
      error_code: string | null;
    }>(
      `SELECT tenant_id, event_id, status, attempts, error_code FROM platform.event_delivery
        WHERE subscriber = 'probe.record-receipt' AND event_id = ANY($1::uuid[])`,
      [eventIds],
    );
    return rows;
  }

  async function receiptsOf(eventIds: readonly string[]) {
    const { rows } = await owner.query<{ tenant_id: string; event_id: string }>(
      'SELECT tenant_id, event_id FROM probe.receipt WHERE event_id = ANY($1::uuid[])',
      [eventIds],
    );
    return rows;
  }

  async function outboxIdsOf(context: CallContext): Promise<string[]> {
    const { rows } = await owner.query<{ event_id: string }>(
      'SELECT event_id FROM probe.outbox WHERE correlation_id = $1 ORDER BY event_id',
      [context.correlationId],
    );
    return rows.map((row) => row.event_id);
  }

  it('publishes, relays and consumes the events of both tenants, each in its own tenant', async () => {
    const handler = receiptHandler();
    const clock = startClock();
    const { relay, dispatcher, bus } = stackOf(handler, clock);
    const fa = await writeThings('demo-fa', 2);
    const en = await writeThings('demo-en', 3);
    const faIds = await outboxIdsOf(fa);
    const enIds = await outboxIdsOf(en);
    const all = [...faIds, ...enIds];

    const relayed = await relay.runOnce();
    expect(relayed.published).toBe(5);
    expect(bus.published.map((event) => event.eventId).sort()).toEqual([...all].sort());
    // The fan-out is one delivery per event and subscriber, in the event's tenant.
    expect((await deliveriesOf(all)).map((row) => [row.tenant_id, row.status]).sort()).toEqual(
      [
        ...faIds.map(() => ['demo-fa', 'pending']),
        ...enIds.map(() => ['demo-en', 'pending']),
      ].sort(),
    );

    const dispatched = await dispatcher.runOnce();
    expect(dispatched.claimed).toBe(5);
    expect(handler.handled).toHaveLength(5);
    for (const call of handler.handled) {
      // Each handler ran as the system actor of the event's own tenant (exactly one tenant).
      expect(call.context.tenant.tenantId).toBe(call.tenantId);
      expect(call.context.actor.kind).toBe('system');
      expect(call.context.actor.tenantId).toBe(call.tenantId);
      expect(call.handled).toBe(true);
    }
    expect(
      handler.handled
        .filter((call) => call.tenantId === 'demo-fa')
        .map((call) => call.eventId)
        .sort(),
    ).toEqual(faIds);
    expect((await deliveriesOf(all)).every((row) => row.status === 'delivered')).toBe(true);
    expect((await receiptsOf(all)).map((row) => row.event_id).sort()).toEqual([...all].sort());

    // Row-level security: each tenant's application session sees its own receipts only.
    const seenByFa = await asTenant<{ event_id: string }>(
      'demo-fa',
      'SELECT event_id FROM probe.receipt WHERE event_id = ANY($1::uuid[]) ORDER BY event_id',
      [all],
    );
    expect(seenByFa.map((row) => row.event_id)).toEqual(faIds);
    const inboxOfEn = await asTenant<{ event_id: string }>(
      'demo-en',
      'SELECT event_id FROM probe.inbox WHERE event_id = ANY($1::uuid[]) ORDER BY event_id',
      [all],
    );
    expect(inboxOfEn.map((row) => row.event_id)).toEqual(enIds);
  });

  it('a republished outbox row (at least once) adds no second delivery and no second receipt', async () => {
    const handler = receiptHandler();
    const { relay, dispatcher } = stackOf(handler, startClock());
    const context = await writeThings('demo-fa', 2);
    const eventIds = await outboxIdsOf(context);
    await relay.runOnce();
    await dispatcher.runOnce();

    // The relay committed the fan-out but its mark was lost: the rows come back unpublished.
    await owner.query(
      'UPDATE probe.outbox SET published_at = NULL WHERE event_id = ANY($1::uuid[])',
      [eventIds],
    );
    expect((await relay.runOnce()).published).toBe(2);
    expect(await deliveriesOf(eventIds)).toHaveLength(2);
    expect((await dispatcher.runOnce()).claimed).toBe(0);

    expect(await receiptsOf(eventIds)).toHaveLength(2);
    expect(handler.handled).toHaveLength(2);
  });

  it('a delivery handed out again runs the handler but not the work: runOnce answers handled false', async () => {
    const handler = receiptHandler();
    const clock = startClock();
    const { relay, dispatcher } = stackOf(handler, clock);
    const context = await writeThings('demo-en', 1);
    const [eventId] = await outboxIdsOf(context);
    await relay.runOnce();
    await dispatcher.runOnce();

    // The dispatcher's mark was lost (a crash after the handler's commit is the same case,
    // P 6.4): the delivery is pending and due again.
    await owner.query(
      `UPDATE platform.event_delivery
          SET status = 'pending', delivered_at = NULL, next_attempt_at = now() - interval '1 second'
        WHERE event_id = $1::uuid AND subscriber = 'probe.record-receipt'`,
      [eventId],
    );
    clock.set(Temporal.Now.instant());
    expect((await dispatcher.runOnce()).claimed).toBe(1);

    expect(handler.handled.map((call) => call.handled)).toEqual([true, false]);
    expect(await receiptsOf([eventId!])).toHaveLength(1);
    expect((await deliveriesOf([eventId!]))[0]).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('a failed handler leaves the delivery pending with its error, and the retry consumes it once', async () => {
    const handler = receiptHandler({ throwOnce: true });
    const clock = startClock();
    const { relay, dispatcher } = stackOf(handler, clock);
    const context = await writeThings('demo-fa', 1);
    const [eventId] = await outboxIdsOf(context);
    await relay.runOnce();

    await dispatcher.runOnce();
    expect((await deliveriesOf([eventId!]))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      error_code: 'delivery.handler-failed',
    });
    expect(await receiptsOf([eventId!])).toHaveLength(0);

    // Not due before its back-off; due after it.
    expect((await dispatcher.runOnce()).claimed).toBe(0);
    clock.advance(Temporal.Duration.from({ minutes: 5 }));
    expect((await dispatcher.runOnce()).claimed).toBe(1);
    expect((await deliveriesOf([eventId!]))[0]).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(await receiptsOf([eventId!])).toHaveLength(1);
  });

  it('two relays at once publish each row once (FOR UPDATE SKIP LOCKED)', async () => {
    const handler = receiptHandler();
    const clock = startClock();
    const first = stackOf(handler, clock);
    const second = stackOf(handler, clock);
    const contexts = await Promise.all([
      writeThings('demo-fa', 20),
      writeThings('demo-en', 20),
      writeThings('demo-fa', 20),
    ]);
    const eventIds = (await Promise.all(contexts.map(outboxIdsOf))).flat();

    let more = true;
    while (more) {
      const passes = await Promise.all([first.relay.runOnce(), second.relay.runOnce()]);
      more = passes.some((pass) => pass.published > 0);
    }

    const published = [...first.bus.published, ...second.bus.published].map((e) => e.eventId);
    expect(published.filter((id) => eventIds.includes(id)).sort()).toEqual([...eventIds].sort());
    expect(await deliveriesOf(eventIds)).toHaveLength(60);
  });

  it('runOnce refuses a delivery the dispatcher did not hand out, and one of another tenant', async () => {
    const handler = receiptHandler();
    const { relay } = stackOf(handler, startClock());
    const context = await writeThings('demo-fa', 1);
    const [eventId] = await outboxIdsOf(context);
    await relay.runOnce();

    const forged = {
      eventId,
      subscriber: 'probe.record-receipt',
      attempt: 1,
    } as unknown as EventDelivery;
    await expect(
      db.unitOfWork.runOnce(tenantOf('demo-fa'), forged, () => Promise.resolve(ok(undefined))),
    ).rejects.toBeInstanceOf(UnknownDeliveryError);

    // A handed-out delivery used in the other tenant: the ledger refuses it too.
    let captured: { delivery: EventDelivery; tenant: string } | undefined;
    const capturing = subscription({
      name: 'probe.capture',
      event: thingRecorded,
      handle: (_event, delivery, subscriber) => {
        captured = { delivery, tenant: subscriber.tenant.tenantId };
        return Promise.resolve();
      },
    });
    const registry = new SubscriptionRegistry();
    registry.register('probe', [capturing]);
    registry.seal();
    const tenants = new TenantRegistry(
      new Map(TEST_TENANTS.map((code) => [testTenantId(code), {} as TenantConfig] as const)),
    );
    const clock = startClock();
    await owner.query(
      `INSERT INTO platform.event_delivery
         (tenant_id, event_id, subscriber, status, attempts, next_attempt_at, type, occurred_at,
          aggregate_type, aggregate_id, aggregate_version, correlation_id, causation_id, payload,
          created_at)
       SELECT d.tenant_id, d.event_id, 'probe.capture', 'pending', 0, now() - interval '1 second',
              d.type, d.occurred_at, d.aggregate_type, d.aggregate_id, d.aggregate_version,
              d.correlation_id, d.causation_id, d.payload, now()
         FROM platform.event_delivery d
        WHERE d.event_id = $1::uuid AND d.subscriber = 'probe.record-receipt'`,
      [eventId],
    );
    await new PrismaEventDispatcher(
      db.root,
      tenants,
      new TenantContextFactory(tenants),
      registry,
      clock,
    ).runOnce();
    expect(captured?.tenant).toBe('demo-fa');
    const other = tenantOf(otherTenantOf('demo-fa'));
    await expect(
      db.unitOfWork.runOnce(other, captured!.delivery, () => Promise.resolve(ok(undefined))),
    ).rejects.toBeInstanceOf(UnknownDeliveryError);
  });
  // QA review 5.5: the dispatcher's dead-letter and give-back paths against PostgreSQL, per
  // tenant. The owner reads the rows directly (FORCE is lifted on this copy).
  describe.each(TEST_TENANTS)('dead letters and give-backs for %s', (code) => {
    /** The one delivery row of an event, whatever its subscriber. */
    async function deliveryOf(eventId: string) {
      const { rows } = await owner.query<{
        subscriber: string;
        status: string;
        attempts: number;
        error_code: string | null;
        dead_at: Date | null;
        next_attempt_at: Date;
      }>(
        `SELECT subscriber, status, attempts, error_code, dead_at, next_attempt_at
           FROM platform.event_delivery WHERE event_id = $1::uuid`,
        [eventId],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    it('dead-letters a delivery after its 10th failed claim, with dead_at and the error code', async () => {
      let calls = 0;
      const failing = subscription({
        name: 'probe.record-receipt',
        event: thingRecorded,
        handle: () => {
          calls += 1;
          return Promise.reject(new Error('handler down'));
        },
      });
      const clock = startClock();
      const { relay, dispatcher } = stackOf({ entry: failing, handled: [] }, clock);
      const [eventId] = await outboxIdsOf(await writeThings(code, 1));
      await relay.runOnce();

      for (let claim = 1; claim <= 10; claim += 1) {
        expect((await dispatcher.runOnce()).claimed).toBe(1);
        const row = await deliveryOf(eventId!);
        expect(row).toMatchObject({
          status: claim < 10 ? 'pending' : 'dead',
          attempts: claim,
          error_code: 'delivery.handler-failed',
        });
        expect(row.dead_at === null).toBe(claim < 10);
        // Past the longest back-off (1 h), so the next pass claims it again.
        clock.advance(Temporal.Duration.from({ hours: 2 }));
      }

      expect(calls).toBe(10);
      expect((await dispatcher.runOnce()).claimed).toBe(0);
      expect(await receiptsOf([eventId!])).toEqual([]);
    });

    it.each<[string, string, string]>([
      [
        'an undecodable payload',
        `UPDATE platform.event_delivery SET payload = payload || '{"count": "many"}'::jsonb
          WHERE event_id = $1::uuid`,
        'delivery.payload-undecodable',
      ],
      [
        'an unknown subscriber',
        "UPDATE platform.event_delivery SET subscriber = 'probe.gone' WHERE event_id = $1::uuid",
        'delivery.unknown-subscriber',
      ],
      [
        "a type that is not the subscription's",
        `UPDATE platform.event_delivery SET type = 'probe.other-happened.v1'
          WHERE event_id = $1::uuid`,
        'delivery.type-mismatch',
      ],
    ])(
      'dead-letters %s at its first claim, without running the handler',
      async (_, edit, error) => {
        const handler = receiptHandler();
        const clock = startClock();
        const { relay, dispatcher } = stackOf(handler, clock);
        const [eventId] = await outboxIdsOf(await writeThings(code, 1));
        await relay.runOnce();
        await owner.query(edit, [eventId]);

        expect((await dispatcher.runOnce()).claimed).toBe(1);
        const row = await deliveryOf(eventId!);
        expect(row).toMatchObject({ status: 'dead', attempts: 1, error_code: error });
        expect(row.dead_at).not.toBeNull();
        expect(handler.handled).toEqual([]);
        clock.advance(Temporal.Duration.from({ hours: 2 }));
        expect((await dispatcher.runOnce()).claimed).toBe(0);
      },
    );

    /**
     * A subscription whose first call does its work and then lets `afterFirst` run (it moves
     * the clock, so the rest of the batch's lease is too short); every call settles its delivery.
     */
    function slowFirstHandler(afterFirst: () => Promise<void>) {
      const handled: string[] = [];
      const entry = subscription({
        name: 'probe.record-receipt',
        event: thingRecorded,
        handle: async (event, delivery: EventDelivery, context) => {
          await db.unitOfWork.runOnce(context.tenant, delivery, () =>
            Promise.resolve(ok(undefined)),
          );
          handled.push(event.eventId);
          if (handled.length === 1) await afterFirst();
        },
      });
      return { entry, handled };
    }

    it('gives back the rest of a batch whose lease ran short: the attempt is restored and the row is due now', async () => {
      const clock = startClock();
      const handler = slowFirstHandler(() => {
        // 15 s into a 30 s lease, less than the 20 s handler budget is left.
        clock.advance(Temporal.Duration.from({ seconds: 15 }));
        return Promise.resolve();
      });
      const { relay, dispatcher } = stackOf({ entry: handler.entry, handled: [] }, clock);
      const eventIds = await outboxIdsOf(await writeThings(code, 2));
      await relay.runOnce();

      expect((await dispatcher.runOnce()).claimed).toBe(2);
      expect(handler.handled).toHaveLength(1);
      const released = eventIds.find((id) => id !== handler.handled[0])!;
      const row = await deliveryOf(released);
      expect(row).toMatchObject({ status: 'pending', attempts: 0, error_code: null });
      expect(row.next_attempt_at.getTime()).toBe(clock.now().epochMilliseconds);

      // Due at once, and consumed by the next pass with its first counted attempt.
      expect((await dispatcher.runOnce()).claimed).toBe(1);
      expect(await deliveryOf(released)).toMatchObject({ status: 'delivered', attempts: 1 });
      expect([...handler.handled].sort()).toEqual([...eventIds].sort());
    });

    it('a stale give-back changes nothing: another dispatcher has claimed and delivered the row', async () => {
      const clock = startClock();
      // The second dispatcher needs the handler's entry, and the handler calls it.
      const peer: { second?: PrismaEventDispatcher } = {};
      const handler = slowFirstHandler(async () => {
        // Past the 30 s lease: the second dispatcher claims the rest of the batch again.
        clock.advance(Temporal.Duration.from({ seconds: 31 }));
        expect((await peer.second!.runOnce()).claimed).toBe(1);
      });
      const first = stackOf({ entry: handler.entry, handled: [] }, clock);
      peer.second = stackOf({ entry: handler.entry, handled: [] }, clock).dispatcher;
      const eventIds = await outboxIdsOf(await writeThings(code, 2));
      await first.relay.runOnce();

      expect((await first.dispatcher.runOnce()).claimed).toBe(2);
      // The first dispatcher's give-back of the row still names its own claim (attempt 1 and
      // the old lease), so it matches nothing: the second claim and its delivery stand.
      const late = eventIds.find((id) => id !== handler.handled[0])!;
      expect(await deliveryOf(late)).toMatchObject({ status: 'delivered', attempts: 2 });
      expect([...handler.handled].sort()).toEqual([...eventIds].sort());
    });
  });
});
