// Ported from Mondapac apps/api/src/platform/persistence/outbox/prisma-outbox-relay.ts, Market
// adapted to Tenant. Phoenix change: every relay transaction first sets `app.tenant_id` to the
// tenant it claims for (row-level security, ADR-02), so it sees and marks that tenant's rows
// only; Mondapac's relay ran without a tenant setting. `unhostedMarketsWithRows` is not ported
// (see events/event-bus.ts).
import { Logger } from '@nestjs/common';
import { parseCorrelationId, parseId, Temporal } from '@phoenix/shared-kernel';
import type { Clock, DomainEvent, JsonObject, TenantContext } from '@phoenix/shared-kernel';
import {
  RELAY_BATCH_SIZE,
  RELAY_LAG_LOG_MS,
  type EventBus,
  type OutboxRelay,
  type RelayPass,
  type RelayTransaction,
} from '../../events/event-bus';
import type { TenantRegistry } from '../../tenant-config/tenant-registry';
import type { TenantContextFactory } from '../../tenant-context/tenant-context.factory';
import { DEFAULT_UNIT_TIMEOUT_MS } from '../../unit-of-work/unit-of-work';
import type { ModelMap } from '../model-map';
import type { PrismaRoot } from '../prisma-root';
import { setTenantStatement } from '../session-statements';

/** A schema or table name from the model map, safe to quote into SQL. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** One module's outbox table, as the relay addresses it. */
export interface OutboxTable {
  readonly module: string;
  readonly schema: string;
  readonly table: string;
}

/** Every module outbox of the model map (P 6.1). */
export function outboxTablesOf(map: ModelMap): OutboxTable[] {
  const tables: OutboxTable[] = [];
  for (const [module, entry] of Object.entries(map.modules)) {
    if (entry.outboxModel === null) continue;
    const model = map.models[entry.outboxModel];
    const schema = model?.schema ?? null;
    if (
      model === undefined ||
      schema === null ||
      !IDENTIFIER.test(schema) ||
      !IDENTIFIER.test(model.table)
    ) {
      throw new Error(`The outbox of module "${module}" has no usable schema and table in the map`);
    }
    tables.push({ module, schema, table: model.table });
  }
  return tables.sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0));
}

/** The envelope columns as the claim returns them. */
interface OutboxRecord {
  readonly event_id: string;
  readonly type: string;
  readonly occurred_at: Date;
  readonly tenant_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: JsonObject;
}

const ENVELOPE_COLUMNS =
  'event_id, type, occurred_at, tenant_id, aggregate_type, aggregate_id, ' +
  'aggregate_version, correlation_id, causation_id, payload';

/** A row the database accepted but the kernel does not: a broken invariant, never skipped. */
function checked<T>(result: { ok: true; value: T } | { ok: false }, column: string): T {
  if (!result.ok) throw new Error(`An outbox row has a malformed ${column}`);
  return result.value;
}

function eventOf(row: OutboxRecord, tenant: TenantContext): DomainEvent {
  if (row.tenant_id !== tenant.tenantId) {
    throw new Error('An outbox row of another tenant was claimed');
  }
  return Object.freeze({
    eventId: checked(parseId<'event'>(row.event_id), 'event_id'),
    type: row.type,
    occurredAt: Temporal.Instant.fromEpochMilliseconds(row.occurred_at.getTime()),
    tenant,
    aggregateType: row.aggregate_type,
    aggregateId: checked(parseId(row.aggregate_id), 'aggregate_id'),
    aggregateVersion: row.aggregate_version,
    correlationId: checked(parseCorrelationId(row.correlation_id), 'correlation_id'),
    causationId:
      row.causation_id === null ? null : checked(parseId(row.causation_id), 'causation_id'),
    payload: row.payload,
  });
}

/**
 * The relay of platform persistence design, "P", 6.1, for the `worker` role. One pass visits
 * every module outbox of the model map and, for each, every hosted tenant, each in one short
 * transaction of its own on the base client: set the tenant, claim up to 50 unpublished rows of
 * that tenant with `FOR UPDATE SKIP LOCKED`, hand them to the bus with the transaction, mark
 * them published at the `Clock` instant, commit. A failure rolls the batch back, so the rows
 * stay unpublished and the next pass of any worker takes them (P 6.2): at least once, no loss,
 * no order. Every event of a batch carries the one tenant of its transaction. Logs carry event
 * id, type, tenant and correlation id; never a payload.
 */
export class PrismaOutboxRelay implements OutboxRelay {
  private readonly logger = new Logger('OutboxRelay');
  private readonly tables: readonly OutboxTable[];

  constructor(
    private readonly root: PrismaRoot,
    map: ModelMap,
    private readonly tenants: TenantRegistry,
    private readonly contexts: TenantContextFactory,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {
    this.tables = outboxTablesOf(map);
  }

  async runOnce(): Promise<RelayPass> {
    let published = 0;
    let fullBatch = false;
    for (const table of this.tables) {
      for (const tenantId of this.tenants.hostedTenantIds()) {
        const context = this.contexts.forTenant(tenantId);
        if (!context.ok) throw new Error(`The hosted tenant ${tenantId} has no context`);
        const count = await this.relayBatch(table, context.value);
        published += count;
        if (count === RELAY_BATCH_SIZE) fullBatch = true;
      }
    }
    return { published, fullBatch };
  }

  private async relayBatch(outbox: OutboxTable, tenant: TenantContext): Promise<number> {
    const { schema, table } = outbox;
    return this.root.$transaction(
      async (transaction) => {
        // Row-level security (ADR-02): this transaction sees and writes this tenant's rows only.
        await transaction.$queryRaw(setTenantStatement(tenant));
        const rows = await transaction.$queryRawUnsafe<OutboxRecord[]>(
          `SELECT ${ENVELOPE_COLUMNS} FROM "${schema}"."${table}"
            WHERE tenant_id = $1 AND published_at IS NULL
            ORDER BY event_id LIMIT $2
              FOR UPDATE SKIP LOCKED`,
          tenant.tenantId,
          RELAY_BATCH_SIZE,
        );
        if (rows.length === 0) return 0;

        const events = rows.map((row) => eventOf(row, tenant));
        const now = this.clock.now();
        this.logLag(outbox, tenant, events[0]!, now);
        await this.bus.publish(events, transaction as unknown as RelayTransaction);
        await transaction.$executeRawUnsafe(
          `UPDATE "${schema}"."${table}" SET published_at = $1
            WHERE tenant_id = $2 AND event_id = ANY($3::uuid[])`,
          new Date(now.epochMilliseconds),
          tenant.tenantId,
          events.map((event) => event.eventId),
        );
        for (const event of events) {
          this.logger.debug({
            msg: 'outbox.event-published',
            eventId: event.eventId,
            type: event.type,
            tenantId: tenant.tenantId,
            correlationId: event.correlationId,
          });
        }
        return rows.length;
      },
      { maxWait: this.root.connectionWaitMs, timeout: DEFAULT_UNIT_TIMEOUT_MS },
    );
  }

  /** P 6.2 and PK3: the age of the oldest row of the batch, when above 5 s. */
  private logLag(
    outbox: OutboxTable,
    tenant: TenantContext,
    oldest: DomainEvent,
    now: Temporal.Instant,
  ): void {
    const ageMs = now.epochMilliseconds - oldest.occurredAt.epochMilliseconds;
    if (ageMs <= RELAY_LAG_LOG_MS) return;
    this.logger.warn({
      msg: 'outbox.lagging',
      module: outbox.module,
      tenantId: tenant.tenantId,
      eventId: oldest.eventId,
      ageMs,
    });
  }
}
