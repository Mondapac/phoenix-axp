// Ported from Mondapac apps/api/test/db/platform-audit-chain.db-spec.ts, Market adapted to Tenant.
import { randomBytes } from 'node:crypto';
import { devNull } from 'node:os';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import pino from 'pino';
import { ok, Temporal, uuidV7 } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { FixedClock, testCallContext, testTenantContext } from '@phoenix/shared-kernel/testing';
import { AppModule } from '../../src/app.module';
import {
  AUDIT_CHAIN_STORE,
  SealInsertConflictError,
  keyOf,
  type AuditChainStore,
  type SealRecord,
} from '../../src/platform/audit/audit-chain-store';
import { chainHashOf, genesisPrev, hashAuditRow } from '../../src/platform/audit/audit-hash';
import { AuditSealer } from '../../src/platform/audit/audit-sealer';
import { AuditVerifier } from '../../src/platform/audit/audit-verifier';
import {
  AUDIT_VERIFY_EXIT,
  runAuditVerifyCommand,
} from '../../src/platform/audit/audit-verify-command';
import { CLOCK } from '../../src/platform/clock/clock.module';
import { UNIT_OF_WORK, type UnitOfWork } from '../../src/platform/unit-of-work/unit-of-work';
import { RecordingAnchor } from '../support/in-memory-audit-chain';
import { testAppConfig, TEST_TENANTS } from '../support/test-config';
import { auditOwnerTestDatabaseUrl, auditTestDatabaseUrl } from './test-database';

// The database half of the audit chain (Mondapac identity slice 6b): the sealer and the verifier
// on the real tables, through the application login (under row-level security, so its session
// names its tenant first), for both tenant fixtures. The owner connection plays the attacker (and
// resets the chain between cases) with the user triggers off, in a copy of the run database
// that no other file uses (global-setup.ts, `audit`).

const START = Temporal.Instant.from('2026-10-08T06:00:00Z');
const tenantOf = (code: string) => testTenantContext(code);
/** The seal's foreign key to its row (DP 11.3), dropped and restored by the E1 cases. */
const SEAL_FOREIGN_KEY = 'audit_log_seal_tenant_id_audit_occurred_at_audit_log_id_fkey';
const CHAIN_TABLES = [
  'platform.audit_log_seal',
  'platform.audit_chain_checkpoint',
  'platform.audit_log',
];

describe('the audit chain on the database', () => {
  const clock = new FixedClock(START);
  let app: INestApplicationContext;
  let unitOfWork: UnitOfWork;
  let store: AuditChainStore;
  /** The owner of the copy: the migration role. */
  let owner: Client;
  /** The application login, which may INSERT into the chain tables (DP 11.6). */
  let sql: Client;
  let errors: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({
          config: testAppConfig({ DATABASE_URL: auditTestDatabaseUrl() }),
          logDestination: pino.destination(devNull),
        }),
      ],
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = await moduleRef.init();
    unitOfWork = app.get<UnitOfWork>(UNIT_OF_WORK);
    store = app.get<AuditChainStore>(AUDIT_CHAIN_STORE);
    owner = new Client({ connectionString: auditOwnerTestDatabaseUrl() });
    await owner.connect();
    sql = new Client({ connectionString: auditTestDatabaseUrl() });
    await sql.connect();
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
    await app.close();
  });

  beforeEach(async () => {
    clock.set(START);
    await asOwnerWithoutTriggers(async () => {
      for (const table of CHAIN_TABLES) await owner.query(`DELETE FROM ${table}`);
    });
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Runs `work` as the owner with the append-only triggers off, in one transaction that turns
   * them on again before it commits, so no other session ever sees them off (Mojtaba L3).
   */
  async function asOwnerWithoutTriggers(work: () => Promise<void>): Promise<void> {
    await owner.query('BEGIN');
    try {
      for (const table of CHAIN_TABLES) {
        await owner.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await work();
      for (const table of CHAIN_TABLES) {
        await owner.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  /** Empties the chain tables, then runs `ddl` as the owner: the restore of a dropped constraint. */
  async function resetThen(ddl: string): Promise<void> {
    await asOwnerWithoutTriggers(async () => {
      for (const table of CHAIN_TABLES) await owner.query(`DELETE FROM ${table}`);
    });
    await owner.query(ddl);
  }

  /** An audit row at `at`, inserted as the owner; `after` is raw jsonb text. */
  async function rowAt(
    tenant: TenantContext,
    at: Temporal.Instant,
    after = '{"n": 1}',
  ): Promise<string> {
    const id = uuidV7(at.epochMilliseconds, randomBytes(10));
    await owner.query(
      `INSERT INTO platform.audit_log
         (id, tenant_id, occurred_at, actor_type, action, target_type, target_id, after, correlation_id)
       VALUES ($1::uuid, $2, $3, 'SYSTEM', 'probe.thing-recorded', 'probe.thing', $1::text, $4::jsonb, $5)`,
      [
        id,
        tenant.tenantId,
        new Date(at.epochMilliseconds),
        after,
        `chain-${randomBytes(6).toString('hex')}`,
      ],
    );
    return id;
  }

  /** `count` rows a second apart, ending 10 minutes before START. */
  async function rows(tenant: TenantContext, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await rowAt(tenant, START.subtract({ minutes: 10, seconds: count - index })));
    }
    return ids;
  }

  /** Sets the tenant of the application login's session, as the unit of work does (RLS). */
  const useTenant = (tenant: TenantContext) =>
    sql.query("SELECT pg_catalog.set_config('app.tenant_id', $1, false)", [tenant.tenantId]);

  const sealerOf = (anchor = new RecordingAnchor()) =>
    new AuditSealer(unitOfWork, store, anchor, clock);
  const verifierOf = (anchor: RecordingAnchor | null = null) =>
    new AuditVerifier(unitOfWork, store, clock, anchor);

  async function sealCount(tenant: TenantContext): Promise<number> {
    const { rows: found } = await owner.query<{ count: string }>(
      'SELECT count(*) FROM platform.audit_log_seal WHERE tenant_id = $1',
      [tenant.tenantId],
    );
    return Number(found[0]!.count);
  }

  async function headOf(tenant: TenantContext): Promise<SealRecord> {
    const result = await unitOfWork.run(
      tenant,
      async () => ok(await store.lastSeals(tenant, 1, 1)),
      {
        readOnly: true,
      },
    );
    if (!result.ok) throw new Error('unreachable');
    return result.value[0]!;
  }

  const codesOf = (findings: readonly { code: string; chainSeq: bigint | null }[]) =>
    findings.map((finding) => [finding.code, finding.chainSeq]);

  describe.each(TEST_TENANTS)('for tenant %s', (code) => {
    const tenant = tenantOf(code);
    const other = tenantOf(code === 'demo-fa' ? 'demo-en' : 'demo-fa');
    const context = testCallContext(tenant, 'system');
    const otherContext = testCallContext(other, 'system');

    it('seals settled rows only, one chain per tenant, and verifies them clean, full and incremental', async () => {
      await rows(tenant, 3);
      await rowAt(tenant, START.subtract({ minutes: 4, seconds: 59 }));
      await rows(other, 2);
      const anchor = new RecordingAnchor();

      await expect(sealerOf(anchor).run(context)).resolves.toMatchObject({
        sealed: 3,
        ended: 'idle',
      });
      expect(await sealCount(tenant)).toBe(3);
      expect(await sealCount(other)).toBe(0);
      expect(anchor.checkpoints.map((a) => [a.tenantId, a.chainSeq])).toEqual([[code, 3n]]);

      await expect(sealerOf().run(otherContext)).resolves.toMatchObject({ sealed: 2 });
      const verifier = verifierOf(anchor);
      await expect(verifier.verify(context, 'full')).resolves.toMatchObject({
        pinnedHead: 3n,
        sealsChecked: 3,
        findings: [],
      });
      await expect(verifier.verify(context, 'incremental')).resolves.toMatchObject({
        fromSeq: 4n,
        sealsChecked: 0,
        findings: [],
      });
      await expect(verifierOf().verify(otherContext, 'full')).resolves.toMatchObject({
        findings: [],
      });
    });

    it('lets two sealers race without a fork: every row is sealed once and the chain verifies', async () => {
      await rows(tenant, 1200);
      const infos = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      // Both sealers read the head before either inserts: a barrier at the first insert forces
      // the contention (Sajad L2).
      const racing = barrierStore(2);
      const outcomes = await Promise.all([
        new AuditSealer(unitOfWork, racing, new RecordingAnchor(), clock).run(context),
        new AuditSealer(unitOfWork, racing, new RecordingAnchor(), clock).run(context),
      ]);
      for (;;) {
        const run = await sealerOf().run(context);
        if (run.sealed === 0) break;
      }

      expect(outcomes.map((run) => run.ended).sort()).toEqual(['idle', 'lost-race']);
      const lost = infos.mock.calls
        .map(([line]) => line as { msg?: string; sqlState?: string })
        .filter((line) => line.msg === 'audit.seal.lost-race');
      expect(lost).toHaveLength(1);
      expect(['23505', '55P03', '40P01']).toContain(lost[0]!.sqlState);
      expect(alertsOf('audit.chain.broken')).toEqual([]);
      expect(alertsOf('audit.seal.duplicate-row')).toEqual([]);
      expect(await sealCount(tenant)).toBe(1200);
      await expect(verifierOf().verify(context, 'full')).resolves.toMatchObject({
        sealsChecked: 1200,
        findings: [],
      });
    });

    it('tells the two unique violations apart by the constraint name of the Prisma error (Mojtaba F5)', async () => {
      const [first, second] = await rows(tenant, 2);
      await sealerOf().run(context);
      const head = await headOf(tenant);
      expect(head.auditLogId).toBe(second);
      const insert = (seal: SealRecord) =>
        unitOfWork.run(tenant, async () => {
          await store.insertSeals(tenant, [seal]);
          return ok(undefined);
        });

      // The primary key: another sealer took the position.
      const third = await rowAt(tenant, START.subtract({ minutes: 9 }));
      const position = await insert({
        ...head,
        auditLogId: third,
        auditOccurredAt: START.subtract({ minutes: 9 }),
      }).catch((error: unknown) => error);
      expect(position).toBeInstanceOf(SealInsertConflictError);
      expect((position as SealInsertConflictError).conflict).toBe('position-taken');

      // The unique key: the row is already sealed in the epoch.
      const firstKey = keyOf(await rowRecord(tenant, first!));
      const firstSeal = (await unitOfWork.run(
        tenant,
        async () => ok(await store.sealsOfRows(tenant, 1, [firstKey])),
        {
          readOnly: true,
        },
      )) as { ok: true; value: SealRecord[] };
      const row = await insert({ ...firstSeal.value[0]!, chainSeq: 99n }).catch(
        (error: unknown) => error,
      );
      expect(row).toBeInstanceOf(SealInsertConflictError);
      expect((row as SealInsertConflictError).conflict).toBe('row-sealed');
    });

    it('stops a tenant whose watermark is in the future and alerts stalled while rows wait (Hassan N1 a)', async () => {
      await rows(tenant, 1);
      await sealerOf().run(context);
      const head = await headOf(tenant);
      // The owner forges a row in the future with a correctly linked seal at head + 1.
      const futureAt = START.add({ hours: 2 });
      const forged = await rowAt(tenant, futureAt);
      const forgedRow = await rowRecord(tenant, forged);
      const rowHash = hashAuditRow(forgedRow).hash;
      const chainHash = chainHashOf({
        hashVersion: 1,
        epoch: 1,
        prev: head.chainHash,
        chainSeq: 2n,
        late: false,
        rowHash,
      });
      await insertSealAsOwner(tenant, {
        epoch: 1,
        chainSeq: 2n,
        id: forged,
        at: futureAt,
        rowHash,
        chainHash,
      });
      await rowAt(tenant, START.subtract({ minutes: 6 }));
      await rows(other, 1);

      const sealer = sealerOf();
      const runs = [];
      for (let index = 0; index < 3; index += 1) runs.push(await sealer.run(context));

      expect(runs.map((run) => run.ended)).toEqual([
        'watermark-future',
        'watermark-future',
        'watermark-future',
      ]);
      expect(await sealCount(tenant)).toBe(2);
      expect(alertsOf('audit.seal.watermark-future')[0]).toMatchObject({
        tenantId: code,
        chainSeq: '2',
        auditLogId: forged,
      });
      expect(alertsOf('audit.seal.stalled')).toHaveLength(1);
      // The verifier reports the forged watermark, the waiting row (check (d) stops at now - S)
      // and the row in the future; the other tenant seals and verifies.
      expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
        ['audit.seal.watermark-future', 2n],
        ['audit.row.unsealed', null],
        ['audit.row.future', null],
      ]);
      await expect(sealer.run(otherContext)).resolves.toMatchObject({ sealed: 1, ended: 'idle' });
      await expect(verifierOf().verify(otherContext, 'full')).resolves.toMatchObject({
        findings: [],
      });
    });

    it('reports a seal of an unknown epoch and keeps sealing epoch 1 (F12)', async () => {
      await rows(tenant, 2);
      await sealerOf().run(context);
      const spliced = await rowAt(tenant, START.subtract({ minutes: 8 }));
      const rowHash = hashAuditRow(await rowRecord(tenant, spliced)).hash;
      const chainHash = chainHashOf({
        hashVersion: 1,
        epoch: 2,
        prev: genesisPrev(),
        chainSeq: 1n,
        late: false,
        rowHash,
      });
      await insertSealAsOwner(tenant, {
        epoch: 2,
        chainSeq: 1n,
        id: spliced,
        at: START.subtract({ minutes: 8 }),
        rowHash,
        chainHash,
      });
      await rowAt(tenant, START.subtract({ minutes: 7 }));

      await expect(sealerOf().run(context)).resolves.toMatchObject({ ended: 'idle' });
      const head = await headOf(tenant);
      expect(head.epoch).toBe(1);
      const report = await verifierOf().verify(context, 'full');
      expect(codesOf(report.findings)).toEqual([['audit.seal.unknown-epoch', 1n]]);
      expect(report.findings[0]!.epoch).toBe(2);
    });

    it('seals a late row with late = true and verifies clean', async () => {
      await rows(tenant, 3);
      const sealer = sealerOf();
      await sealer.run(context);
      // A row committed late, below the watermark.
      await rowAt(tenant, START.subtract({ minutes: 10, seconds: 2, milliseconds: 500 }));
      clock.advance(Temporal.Duration.from({ minutes: 5 }));

      await expect(sealer.run(context)).resolves.toMatchObject({ sealed: 1, late: 1 });
      expect(alertsOf('audit.seal.late-row')).toHaveLength(1);
      await expect(verifierOf().verify(context, 'full')).resolves.toMatchObject({
        lateSeals: 1,
        findings: [],
      });

      // The next normal run seals new rows on top: the chain grows, no conflict (Sajad L3).
      await rowAt(tenant, clock.now().subtract({ minutes: 6 }));
      await rowAt(tenant, clock.now().subtract({ minutes: 5, seconds: 30 }));
      await expect(sealer.run(context)).resolves.toMatchObject({
        sealed: 2,
        late: 0,
        ended: 'idle',
      });
      expect((await headOf(tenant)).chainSeq).toBe(6n);
      expect(alertsOf('audit.seal.duplicate-row')).toEqual([]);
      await expect(verifierOf().verify(context, 'full')).resolves.toMatchObject({
        sealsChecked: 6,
        findings: [],
      });
    });

    it('seals a jsonb number beyond the double range with the fallback hash and flags it (Hassan M2)', async () => {
      await rows(tenant, 1);
      await rowAt(tenant, START.subtract({ minutes: 9 }), '{"n": 1e400}');

      await expect(sealerOf().run(context)).resolves.toMatchObject({ sealed: 2, ended: 'idle' });
      expect(alertsOf('audit.row.noncanonical')).toEqual([
        expect.objectContaining({ chainSeq: '2' }),
      ]);
      expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
        ['audit.row.noncanonical', 2n],
      ]);
    });

    describe('tampering by the owner with the triggers off', () => {
      async function sealedChain(count: number, anchor = new RecordingAnchor()) {
        const ids = await rows(tenant, count);
        await rows(other, 2);
        await sealerOf(anchor).run(context);
        await sealerOf().run(otherContext);
        return ids;
      }

      async function tamper(statement: string, values: unknown[]): Promise<void> {
        await asOwnerWithoutTriggers(async () => {
          await owner.query(statement, values);
        });
      }

      afterEach(async () => {
        // Tampering with one tenant never shows in the other.
        await expect(verifierOf().verify(otherContext, 'full')).resolves.toMatchObject({
          findings: [],
        });
      });

      it('an edited row: audit.row.mismatch, and the command exits 2', async () => {
        const ids = await sealedChain(3);
        const lines: string[] = [];
        await expect(
          runAuditVerifyCommand(
            app,
            ['--tenant', code, '--full'],
            (l) => lines.push(l),
            (l) => lines.push(l),
          ),
        ).resolves.toBe(AUDIT_VERIFY_EXIT.clean);

        await tamper(`UPDATE platform.audit_log SET after = '{"n": 2}'::jsonb WHERE id = $1`, [
          ids[1],
        ]);

        expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
          ['audit.row.mismatch', 2n],
        ]);
        await expect(
          runAuditVerifyCommand(
            app,
            ['--tenant', code, '--full'],
            (l) => lines.push(l),
            (l) => lines.push(l),
          ),
        ).resolves.toBe(AUDIT_VERIFY_EXIT.findings);
        expect(lines.join('\n')).not.toContain('"n"');
      });

      it('a deleted row and its seal: audit.chain.gap', async () => {
        const ids = await sealedChain(4);
        await tamper('DELETE FROM platform.audit_log_seal WHERE audit_log_id = $1', [ids[1]]);
        await tamper('DELETE FROM platform.audit_log WHERE id = $1', [ids[1]]);

        expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
          ['audit.chain.gap', 2n],
        ]);
      });

      it('a cut tail: audit.anchor.mismatch from the anchor above the head', async () => {
        const anchor = new RecordingAnchor();
        const ids = await sealedChain(3, anchor);
        await tamper('DELETE FROM platform.audit_log_seal WHERE audit_log_id = $1', [ids[2]]);
        await tamper('DELETE FROM platform.audit_chain_checkpoint WHERE tenant_id = $1', [code]);

        // Row 3 is now above the watermark, so only the anchor tells.
        expect(codesOf((await verifierOf(anchor).verify(context, 'full')).findings)).toEqual([
          ['audit.anchor.mismatch', 3n],
        ]);
      });

      it('a changed chain_hash: audit.chain.broken at it and at the next link', async () => {
        await sealedChain(4);
        await tamper(
          `UPDATE platform.audit_log_seal SET chain_hash = $2 WHERE tenant_id = $1 AND epoch = 1 AND chain_seq = 2`,
          [code, Buffer.alloc(32, 7)],
        );

        expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
          ['audit.chain.broken', 2n],
          ['audit.chain.broken', 3n],
        ]);
      });

      it('a raised hash_version past a dropped CHECK: audit.seal.hash-version and a broken link (Mohammad 12)', async () => {
        await sealedChain(3);
        await owner.query(
          'ALTER TABLE platform.audit_log_seal DROP CONSTRAINT audit_log_seal_hash_version_check',
        );
        try {
          await tamper(
            'UPDATE platform.audit_log_seal SET hash_version = 2 WHERE tenant_id = $1 AND epoch = 1 AND chain_seq = 2',
            [code],
          );

          // Seal 3 keeps version 1, below the 2 before it: the version went down.
          expect(codesOf((await verifierOf().verify(context, 'full')).findings)).toEqual([
            ['audit.seal.hash-version', 2n],
            ['audit.chain.broken', 2n],
            ['audit.seal.hash-version', 3n],
          ]);
        } finally {
          await resetThen(
            'ALTER TABLE platform.audit_log_seal ADD CONSTRAINT audit_log_seal_hash_version_check CHECK ("hash_version" IN (1))',
          );
        }
      });

      describe('with the seal foreign key dropped (Mohammad E1)', () => {
        beforeEach(async () => {
          await owner.query(
            `ALTER TABLE platform.audit_log_seal DROP CONSTRAINT ${SEAL_FOREIGN_KEY}`,
          );
        });
        afterEach(async () => {
          await resetThen(
            `ALTER TABLE platform.audit_log_seal ADD CONSTRAINT ${SEAL_FOREIGN_KEY}
               FOREIGN KEY (tenant_id, audit_occurred_at, audit_log_id)
               REFERENCES platform.audit_log (tenant_id, occurred_at, id)
               ON DELETE RESTRICT ON UPDATE RESTRICT`,
          );
        });

        it('a sealed row deleted: audit.row.missing, and the verification completes', async () => {
          const ids = await sealedChain(3);
          await tamper('DELETE FROM platform.audit_log WHERE id = $1', [ids[1]]);

          const report = await verifierOf().verify(context, 'full');

          expect(report.complete).toBe(true);
          expect(codesOf(report.findings)).toEqual([['audit.row.missing', 2n]]);
        });

        it("a seal's audit_occurred_at changed: audit.seal.time-mismatch", async () => {
          const ids = await sealedChain(3);
          await tamper(
            `UPDATE platform.audit_log_seal SET audit_occurred_at = audit_occurred_at + interval '1 millisecond'
              WHERE audit_log_id = $1`,
            [ids[1]],
          );

          const codes = codesOf((await verifierOf().verify(context, 'full')).findings);
          expect(codes).toContainEqual(['audit.seal.time-mismatch', 2n]);
          // The anti-join of (d) follows the key, so the row also reads as unsealed.
          expect(codes).toEqual(expect.arrayContaining([['audit.row.unsealed', null]]));
        });
      });

      it('a selected row sealed by another session at a gap: audit.seal.duplicate-row through the sealer (Sajad L4)', async () => {
        const ids = await sealedChain(5);
        // A gap below the head's predecessor, so the head still links.
        await tamper('DELETE FROM platform.audit_log_seal WHERE audit_log_id = $1', [ids[1]]);
        const fresh = await rowAt(tenant, START.subtract({ minutes: 8 }));
        const freshAt = START.subtract({ minutes: 8 });

        // Another session seals the fresh row at the gap and commits while the sealer waits.
        await owner.query('BEGIN');
        await owner.query(
          `INSERT INTO platform.audit_log_seal
             (tenant_id, epoch, chain_seq, audit_log_id, audit_occurred_at, row_hash,
              chain_hash, late, hash_version, sealed_at)
           VALUES ($1, 1, 2, $2, $3, $4, $4, false, 1, $5)`,
          [
            tenant.tenantId,
            fresh,
            new Date(freshAt.epochMilliseconds),
            Buffer.alloc(32, 1),
            new Date(START.epochMilliseconds),
          ],
        );
        const run = sealerOf().run(context);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await owner.query('COMMIT');

        await expect(run).resolves.toMatchObject({ ended: 'duplicate-row', sealed: 0 });
        expect(alertsOf('audit.seal.duplicate-row')).toEqual([
          expect.objectContaining({ tenantId: code, chainSeq: '2', auditLogId: fresh }),
        ]);
      });
    });

    describe('times out of range written by the application login (Hassan M1, Mojtaba)', () => {
      afterEach(async () => {
        await expect(verifierOf().verify(otherContext, 'full')).resolves.toMatchObject({
          findings: [],
        });
      });

      async function rowAtText(occurredAt: string): Promise<string> {
        const id = uuidV7(Date.now(), randomBytes(10));
        await useTenant(tenant);
        await sql.query(
          `INSERT INTO platform.audit_log
             (id, tenant_id, occurred_at, actor_type, action, target_type, target_id, correlation_id)
           VALUES ($1::uuid, $2, $3::timestamptz, 'SYSTEM', 'probe.thing-recorded', 'probe.thing', $1::text, 'chain-range')`,
          [id, tenant.tenantId, occurredAt],
        );
        return id;
      }

      it('rows at infinity, -infinity and year 280000: the sealer seals the rest, the verifier names them, the command exits 2', async () => {
        const odd = [
          await rowAtText('infinity'),
          await rowAtText('-infinity'),
          await rowAtText('280000-01-01 00:00:00+00'),
          await rowAtText('1999-12-31 23:59:59.999+00'),
        ];
        await rows(tenant, 2);
        await rows(other, 1);
        await sealerOf().run(otherContext);

        await expect(sealerOf().run(context)).resolves.toMatchObject({ sealed: 2, ended: 'idle' });
        const report = await verifierOf().verify(context, 'full');
        expect(report.complete).toBe(true);
        expect(report.findings.map((f) => [f.code, f.auditLogId]).sort()).toEqual(
          odd.map((id) => ['audit.row.out-of-range', id]).sort(),
        );
        const lines: string[] = [];
        await expect(
          runAuditVerifyCommand(
            app,
            ['--tenant', code, '--full'],
            (l) => lines.push(l),
            (l) => lines.push(l),
          ),
        ).resolves.toBe(AUDIT_VERIFY_EXIT.findings);
      });

      it('a seal with sealed_at = infinity: no crash, audit.seal.out-of-range by position', async () => {
        await rows(tenant, 2);
        await rows(other, 1);
        await sealerOf().run(context);
        await sealerOf().run(otherContext);
        const head = await headOf(tenant);
        const third = await rowAt(tenant, START.subtract({ minutes: 9 }));
        const rowHash = hashAuditRow(await rowRecord(tenant, third)).hash;
        const chainHash = chainHashOf({
          hashVersion: 1,
          epoch: 1,
          prev: head.chainHash,
          chainSeq: 3n,
          late: false,
          rowHash,
        });
        await useTenant(tenant);
        await sql.query(
          `INSERT INTO platform.audit_log_seal
             (tenant_id, epoch, chain_seq, audit_log_id, audit_occurred_at, row_hash,
              chain_hash, late, hash_version, sealed_at)
           VALUES ($1, 1, 3, $2, $3, $4, $5, false, 1, 'infinity')`,
          [
            tenant.tenantId,
            third,
            new Date(START.subtract({ minutes: 9 }).epochMilliseconds),
            Buffer.from(rowHash),
            Buffer.from(chainHash),
          ],
        );

        const run = await sealerOf().run(context);
        expect(['lost-race', 'duplicate-row']).toContain(run.ended);
        const report = await verifierOf().verify(context, 'full');
        expect(report.complete).toBe(true);
        expect(codesOf(report.findings)).toEqual([['audit.seal.out-of-range', 3n]]);
        // The incremental read has no upper bound at the pinned head (Mojtaba D1).
        const incremental = await verifierOf().verify(context, 'incremental');
        expect(codesOf(incremental.findings)).toEqual([['audit.seal.out-of-range', 3n]]);
      });

      it('a seal in an unknown epoch with sealed_at = infinity: an incremental run names it (Mojtaba D1)', async () => {
        await rows(tenant, 2);
        await rows(other, 1);
        await sealerOf().run(context);
        await sealerOf().run(otherContext);
        const head = await headOf(tenant);
        await useTenant(tenant);
        await sql.query(
          `INSERT INTO platform.audit_log_seal
             (tenant_id, epoch, chain_seq, audit_log_id, audit_occurred_at, row_hash,
              chain_hash, late, hash_version, sealed_at)
           SELECT tenant_id, 2, 1, audit_log_id, audit_occurred_at, row_hash,
                  chain_hash, late, hash_version, 'infinity'
             FROM platform.audit_log_seal
            WHERE tenant_id = $1 AND epoch = 1 AND chain_seq = $2`,
          [code, head.chainSeq],
        );

        const report = await verifierOf().verify(context, 'incremental');
        expect(report.complete).toBe(true);
        expect(report.findings.map(({ code: c, epoch, chainSeq }) => [c, epoch, chainSeq])).toEqual(
          [['audit.seal.out-of-range', 2, 1n]],
        );
      });

      it('a checkpoint with created_at = infinity: the sealer goes on, audit.checkpoint.out-of-range', async () => {
        await rows(tenant, 2);
        await rows(other, 1);
        await sealerOf().run(otherContext);
        await useTenant(tenant);
        await sql.query(
          `INSERT INTO platform.audit_chain_checkpoint
             (tenant_id, epoch, chain_seq, chain_hash, hash_version, created_at)
           VALUES ($1, 1, 50, $2, 1, 'infinity')`,
          [tenant.tenantId, Buffer.alloc(32, 3)],
        );

        await expect(sealerOf().run(context)).resolves.toMatchObject({ sealed: 2, ended: 'idle' });
        const report = await verifierOf().verify(context, 'full');
        expect(codesOf(report.findings)).toEqual([['audit.checkpoint.out-of-range', 50n]]);
      });

      it('a checkpoint at the position the batch reaches: audit.checkpoint.conflict, the batch rolls back (Mojtaba L2)', async () => {
        await rows(tenant, 2);
        await rows(other, 1);
        await sealerOf().run(otherContext);
        await useTenant(tenant);
        await sql.query(
          `INSERT INTO platform.audit_chain_checkpoint
             (tenant_id, epoch, chain_seq, chain_hash, hash_version, created_at)
           VALUES ($1, 1, 2, $2, 1, $3)`,
          [
            tenant.tenantId,
            Buffer.alloc(32, 3),
            new Date(START.subtract({ hours: 2 }).epochMilliseconds),
          ],
        );

        await expect(sealerOf().run(context)).resolves.toMatchObject({
          ended: 'checkpoint-conflict',
          sealed: 0,
        });
        expect(alertsOf('audit.checkpoint.conflict')).toEqual([
          expect.objectContaining({ tenantId: code }),
        ]);
        expect(await sealCount(tenant)).toBe(0);
      });
    });
  });

  /**
   * The real store with a barrier at the first insert of seals: no insert proceeds until
   * `parties` sealers have reached one, so they all read the same head first.
   */
  function barrierStore(parties: number): AuditChainStore {
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'insertSeals') {
          return async (tenant: TenantContext, seals: readonly SealRecord[]) => {
            arrived += 1;
            if (arrived >= parties) release();
            await gate;
            return target.insertSeals(tenant, seals);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }

  /** An audit row read back through the store's mapping, as the sealer hashes it. */
  async function rowRecord(tenant: TenantContext, id: string) {
    const result = await unitOfWork.run(
      tenant,
      async () =>
        ok(await store.rowsAfter(tenant, Temporal.Instant.from('2000-01-01T00:00:00Z'), 10_000)),
      { readOnly: true },
    );
    if (!result.ok) throw new Error('unreachable');
    return result.value.find((row) => row.id === id)!;
  }

  async function insertSealAsOwner(
    tenant: TenantContext,
    seal: {
      epoch: number;
      chainSeq: bigint;
      id: string;
      at: Temporal.Instant;
      rowHash: Uint8Array;
      chainHash: Uint8Array;
    },
  ): Promise<void> {
    await owner.query(
      `INSERT INTO platform.audit_log_seal
         (tenant_id, epoch, chain_seq, audit_log_id, audit_occurred_at, row_hash,
          chain_hash, late, hash_version, sealed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, 1, $8)`,
      [
        tenant.tenantId,
        seal.epoch,
        String(seal.chainSeq),
        seal.id,
        new Date(seal.at.epochMilliseconds),
        Buffer.from(seal.rowHash),
        Buffer.from(seal.chainHash),
        new Date(START.epochMilliseconds),
      ],
    );
  }

  function alertsOf(code: string) {
    return errors.mock.calls
      .map(
        ([line]) =>
          line as {
            msg: string;
            tenantId: string;
            chainSeq: string | null;
            auditLogId: string | null;
          },
      )
      .filter((line) => line.msg === code);
  }
});
