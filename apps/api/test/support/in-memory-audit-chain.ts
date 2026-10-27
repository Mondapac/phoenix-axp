// Ported from Mondapac apps/api/test/support/in-memory-audit-chain.ts, Market adapted to Tenant.
import { Temporal } from '@phoenix/shared-kernel';
import type { ContentHash, TenantContext, Result } from '@phoenix/shared-kernel';
import { inAuditTimeRange } from '../../src/platform/audit/audit-chain-policy';
import {
  CheckpointConflictError,
  compareKeys,
  keyOf,
  SealInsertConflictError,
  type SealPosition,
  type AuditChainStore,
  type CheckpointRecord,
  type OutOfRangeSealScope,
  type SealKey,
  type SealRecord,
  type SealWithRow,
  type Watermark,
} from '../../src/platform/audit/audit-chain-store';
import type { AuditRowRecord } from '../../src/platform/audit/audit-hash';
import type {
  AnchorSink,
  AnchorSource,
  ChainAnchor,
  StoredAnchor,
} from '../../src/platform/audit/anchor-sink';
import type { UnitOfWork, UnitOfWorkOptions } from '../../src/platform/unit-of-work/unit-of-work';

// In-memory doubles of the audit chain's ports, for the unit tests of the sealer and the
// verifier (Mondapac docs/design/domain/platform-audit.md 16, "Unit"). They keep the keys of the seal
// table (Mondapac docs/design/data/platform.md 11.3): the primary key (tenant, epoch, chain_seq), the
// unique key (tenant, epoch, occurred_at, id) and the foreign key to the row with its time. The
// database behaviour itself is covered by test/db/platform-audit-chain.db-spec.ts.

const inWindow = (row: AuditRowRecord, from: Temporal.Instant, upTo: SealKey) =>
  Temporal.Instant.compare(row.occurredAt, from) >= 0 && compareKeys(keyOf(row), upTo) <= 0;

const byKey = (a: AuditRowRecord, b: AuditRowRecord) => compareKeys(keyOf(a), keyOf(b));

/** The chain tables of every tenant, in memory. Tests may edit them to tamper. */
export class InMemoryAuditChainStore implements AuditChainStore {
  readonly rows: AuditRowRecord[] = [];
  seals: SealRecord[] = [];
  checkpoints: CheckpointRecord[] = [];
  /** Runs before each insert of seals: a concurrent sealer, in a test. */
  beforeInsert: ((tenant: TenantContext, seals: readonly SealRecord[]) => void) | null = null;
  /** Runs after each read of a range of seals: a chain that grows during a verification. */
  afterSealsBetween: (() => void) | null = null;
  /** Makes the next insert of seals fail with this error, once. */
  failNextInsert: Error | null = null;
  /** Makes every read of the last seals throw, until reset: a database gone. */
  failReads: Error | null = null;
  /** How many reads of some kinds ran: the cost of check (d) in a test. */
  readonly reads = { unsealedRows: 0, nextRowTime: 0, earliestRowTime: 0 };

  /** The tenant of every row ever added, so a seal keeps its tenant when a test deletes its row. */
  private readonly tenantOfRow = new Map<string, string>();

  addRow(row: AuditRowRecord): void {
    this.rows.push(row);
    this.tenantOfRow.set(row.id, row.tenantId);
  }

  private sealsOf(tenant: TenantContext, epoch?: number): SealRecord[] {
    const ids = new Set(
      [...this.tenantOfRow]
        .filter(([, tenantId]) => tenantId === tenant.tenantId)
        .map(([id]) => id),
    );
    return this.seals.filter(
      (seal) =>
        ids.has(seal.auditLogId) &&
        (epoch === undefined || seal.epoch === epoch) &&
        inAuditTimeRange(seal.sealedAt) &&
        inAuditTimeRange(seal.auditOccurredAt),
    );
  }

  /** Every seal of a tenant, out-of-range times included. */
  private allSealsOf(tenant: TenantContext): SealRecord[] {
    return this.seals.filter((seal) => this.tenantOfRow.get(seal.auditLogId) === tenant.tenantId);
  }

  private rowsOf(tenant: TenantContext): AuditRowRecord[] {
    return this.rows
      .filter((row) => row.tenantId === tenant.tenantId && inAuditTimeRange(row.occurredAt))
      .sort(byKey);
  }

  lastSeals(tenant: TenantContext, epoch: number, count: number): Promise<SealRecord[]> {
    if (this.failReads !== null) return Promise.reject(this.failReads);
    const seals = this.sealsOf(tenant, epoch).sort((a, b) =>
      a.chainSeq < b.chainSeq ? 1 : a.chainSeq > b.chainSeq ? -1 : 0,
    );
    return Promise.resolve(seals.slice(0, count));
  }

  watermark(tenant: TenantContext, epoch: number): Promise<Watermark | null> {
    let best: SealRecord | null = null;
    for (const seal of this.sealsOf(tenant, epoch)) {
      const key = { occurredAt: seal.auditOccurredAt, auditLogId: seal.auditLogId };
      if (
        best === null ||
        compareKeys(key, { occurredAt: best.auditOccurredAt, auditLogId: best.auditLogId }) > 0
      ) {
        best = seal;
      }
    }
    return Promise.resolve(
      best === null
        ? null
        : {
            occurredAt: best.auditOccurredAt,
            auditLogId: best.auditLogId,
            chainSeq: best.chainSeq,
          },
    );
  }

  rowsAbove(
    tenant: TenantContext,
    after: SealKey | null,
    settledUntil: Temporal.Instant,
    limit: number,
  ): Promise<AuditRowRecord[]> {
    return Promise.resolve(
      this.rowsOf(tenant)
        .filter(
          (row) =>
            Temporal.Instant.compare(row.occurredAt, settledUntil) <= 0 &&
            (after === null || compareKeys(keyOf(row), after) > 0),
        )
        .slice(0, limit),
    );
  }

  unsealedRows(
    tenant: TenantContext,
    epoch: number,
    from: Temporal.Instant,
    upTo: SealKey,
    limit: number,
    after?: SealKey,
  ): Promise<AuditRowRecord[]> {
    this.reads.unsealedRows += 1;
    const sealed = new Set(this.sealsOf(tenant, epoch).map((seal) => seal.auditLogId));
    return Promise.resolve(
      this.rowsOf(tenant)
        .filter(
          (row) =>
            inWindow(row, from, upTo) &&
            !sealed.has(row.id) &&
            (after === undefined || compareKeys(keyOf(row), after) > 0),
        )
        .slice(0, limit),
    );
  }

  insertSeals(tenant: TenantContext, seals: readonly SealRecord[]): Promise<void> {
    this.beforeInsert?.(tenant, seals);
    if (this.failNextInsert !== null) {
      const error = this.failNextInsert;
      this.failNextInsert = null;
      return Promise.reject(error);
    }
    const existing = this.sealsOf(tenant);
    for (const seal of seals) {
      const row = this.rows.find((r) => r.id === seal.auditLogId && r.tenantId === tenant.tenantId);
      if (
        row === undefined ||
        row.occurredAt.epochNanoseconds !== seal.auditOccurredAt.epochNanoseconds
      ) {
        return Promise.reject(new Error('foreign key: no such row'));
      }
      const all = [...existing, ...seals.slice(0, seals.indexOf(seal))];
      if (all.some((s) => s.epoch === seal.epoch && s.chainSeq === seal.chainSeq)) {
        return Promise.reject(new SealInsertConflictError('position-taken'));
      }
      if (all.some((s) => s.epoch === seal.epoch && s.auditLogId === seal.auditLogId)) {
        return Promise.reject(new SealInsertConflictError('row-sealed'));
      }
    }
    this.seals.push(...seals);
    return Promise.resolve();
  }

  sealsOfRows(
    tenant: TenantContext,
    epoch: number,
    keys: readonly SealKey[],
  ): Promise<SealRecord[]> {
    return Promise.resolve(
      this.sealsOf(tenant, epoch).filter((s) =>
        keys.some(
          (key) =>
            compareKeys(key, { occurredAt: s.auditOccurredAt, auditLogId: s.auditLogId }) === 0,
        ),
      ),
    );
  }

  private checkpointsOf(tenant: TenantContext, epoch: number): CheckpointRecord[] {
    return this.checkpoints
      .filter((c) => (c as CheckpointRecord & { tenantId?: string }).tenantId === tenant.tenantId)
      .filter((c) => c.epoch === epoch && inAuditTimeRange(c.createdAt))
      .sort((a, b) => (a.chainSeq < b.chainSeq ? -1 : a.chainSeq > b.chainSeq ? 1 : 0));
  }

  latestCheckpoint(
    tenant: TenantContext,
    epoch: number,
    atOrBelow?: bigint,
  ): Promise<CheckpointRecord | null> {
    const fitting = this.checkpointsOf(tenant, epoch).filter(
      (c) => atOrBelow === undefined || c.chainSeq <= atOrBelow,
    );
    return Promise.resolve(fitting.at(-1) ?? null);
  }

  insertCheckpoint(tenant: TenantContext, checkpoint: CheckpointRecord): Promise<void> {
    const taken = this.checkpoints.some(
      (c) =>
        (c as CheckpointRecord & { tenantId?: string }).tenantId === tenant.tenantId &&
        c.epoch === checkpoint.epoch &&
        c.chainSeq === checkpoint.chainSeq,
    );
    if (taken) return Promise.reject(new CheckpointConflictError());
    this.checkpoints.push({ ...checkpoint, tenantId: tenant.tenantId } as CheckpointRecord);
    return Promise.resolve();
  }

  sealsBetween(
    tenant: TenantContext,
    epoch: number,
    fromSeq: bigint,
    toSeq: bigint,
    limit: number,
  ): Promise<SealWithRow[]> {
    const found = this.sealsOf(tenant, epoch)
      .filter((s) => s.chainSeq >= fromSeq && s.chainSeq <= toSeq)
      .sort((a, b) => (a.chainSeq < b.chainSeq ? -1 : a.chainSeq > b.chainSeq ? 1 : 0))
      .slice(0, limit)
      .map((seal) => ({
        seal,
        row:
          this.rows.find((r) => r.id === seal.auditLogId && inAuditTimeRange(r.occurredAt)) ?? null,
      }));
    this.afterSealsBetween?.();
    return Promise.resolve(found);
  }

  checkpointsBetween(
    tenant: TenantContext,
    epoch: number,
    fromSeq: bigint,
    toSeq: bigint,
  ): Promise<CheckpointRecord[]> {
    return Promise.resolve(
      this.checkpointsOf(tenant, epoch).filter((c) => c.chainSeq >= fromSeq && c.chainSeq <= toSeq),
    );
  }

  sealsAboveEpoch(tenant: TenantContext, maxKnown: number, limit: number): Promise<SealRecord[]> {
    return Promise.resolve(
      this.sealsOf(tenant)
        .filter((s) => s.epoch > maxKnown)
        .slice(0, limit),
    );
  }

  rowsAfter(
    tenant: TenantContext,
    after: Temporal.Instant,
    limit: number,
  ): Promise<AuditRowRecord[]> {
    return Promise.resolve(
      this.rowsOf(tenant)
        .filter((row) => Temporal.Instant.compare(row.occurredAt, after) > 0)
        .slice(0, limit),
    );
  }

  earliestRowTime(tenant: TenantContext): Promise<Temporal.Instant | null> {
    this.reads.earliestRowTime += 1;
    return Promise.resolve(this.rowsOf(tenant)[0]?.occurredAt ?? null);
  }

  nextRowTime(
    tenant: TenantContext,
    atOrAfter: Temporal.Instant,
  ): Promise<Temporal.Instant | null> {
    this.reads.nextRowTime += 1;
    return Promise.resolve(
      this.rowsOf(tenant).find((row) => Temporal.Instant.compare(row.occurredAt, atOrAfter) >= 0)
        ?.occurredAt ?? null,
    );
  }

  rowsOutOfRange(tenant: TenantContext, limit: number): Promise<string[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.tenantId === tenant.tenantId && !inAuditTimeRange(row.occurredAt))
        .map((row) => row.id)
        .sort()
        .slice(0, limit),
    );
  }

  sealsOutOfRange(
    tenant: TenantContext,
    limit: number,
    scope: OutOfRangeSealScope,
  ): Promise<SealPosition[]> {
    const within = (s: SealRecord) =>
      scope.mode === 'full' ||
      s.epoch > scope.maxKnownEpoch ||
      (s.epoch === scope.epoch && s.chainSeq >= scope.fromSeq);
    return Promise.resolve(
      this.allSealsOf(tenant)
        .filter((s) => !inAuditTimeRange(s.sealedAt) || !inAuditTimeRange(s.auditOccurredAt))
        .filter(within)
        .sort((a, b) =>
          a.epoch !== b.epoch
            ? a.epoch - b.epoch
            : a.chainSeq < b.chainSeq
              ? -1
              : a.chainSeq > b.chainSeq
                ? 1
                : 0,
        )
        .map(({ epoch, chainSeq, auditLogId }) => ({ epoch, chainSeq, auditLogId }))
        .slice(0, limit),
    );
  }

  checkpointsOutOfRange(
    tenant: TenantContext,
    limit: number,
  ): Promise<{ epoch: number; chainSeq: bigint }[]> {
    return Promise.resolve(
      this.checkpoints
        .filter(
          (c) =>
            (c as CheckpointRecord & { tenantId?: string }).tenantId === tenant.tenantId &&
            !inAuditTimeRange(c.createdAt),
        )
        .map(({ epoch, chainSeq }) => ({ epoch, chainSeq }))
        .slice(0, limit),
    );
  }

  /** Replaces one stored seal (tampering, in a test). */
  replaceSeal(
    epoch: number,
    chainSeq: bigint,
    change: Partial<SealRecord>,
    tenantId: string,
  ): void {
    const ids = new Set(
      [...this.tenantOfRow].filter(([, owner]) => owner === tenantId).map(([id]) => id),
    );
    this.seals = this.seals.map((seal) =>
      ids.has(seal.auditLogId) && seal.epoch === epoch && seal.chainSeq === chainSeq
        ? { ...seal, ...change }
        : seal,
    );
  }
}

/**
 * A UnitOfWork with no database: `run` calls `work` once, read-only or not. Counts the units it
 * ran by kind, so a test can check that the verifier reads in read-only units only (ADR-0025).
 */
export class FakeUnitOfWork implements UnitOfWork {
  readonly units: ('read-only' | 'read-write')[] = [];

  async run<T, E>(
    _tenant: TenantContext,
    work: () => Promise<Result<T, E>>,
    options: UnitOfWorkOptions = {},
  ): Promise<Result<T, E>> {
    this.units.push(options.readOnly === true ? 'read-only' : 'read-write');
    return work();
  }

  runOnce(): never {
    throw new Error('FakeUnitOfWork: runOnce is not used by the audit chain');
  }
}

/** An anchor that records what it is sent and can be read back, version by version. */
export class RecordingAnchor implements AnchorSink, AnchorSource {
  readonly checkpoints: ChainAnchor[] = [];
  readonly heartbeats: ChainAnchor[] = [];
  /** Extra versions stored under a key, as an overwrite would leave them (tests). */
  readonly extraVersions = new Map<string, ContentHash[]>();
  down = false;

  checkpoint(anchor: ChainAnchor): Promise<void> {
    if (this.down) return Promise.reject(new Error('anchor unreachable'));
    this.checkpoints.push(anchor);
    return Promise.resolve();
  }

  heartbeat(anchor: ChainAnchor): Promise<void> {
    if (this.down) return Promise.reject(new Error('anchor unreachable'));
    this.heartbeats.push(anchor);
    return Promise.resolve();
  }

  anchors(tenantId: string, epoch: number): Promise<readonly StoredAnchor[]> {
    return Promise.resolve(
      this.checkpoints
        .filter((a) => a.tenantId === tenantId && a.epoch === epoch)
        .map((a) => ({
          chainSeq: a.chainSeq,
          versions: [
            a.chainHash,
            ...(this.extraVersions.get(`${tenantId}/${epoch}/${a.chainSeq}`) ?? []),
          ],
        })),
    );
  }
}
