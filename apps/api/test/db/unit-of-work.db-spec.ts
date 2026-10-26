import { err, ok } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import { Client } from 'pg';
import request from 'supertest';
import { Controller, Get, Inject } from '@nestjs/common';
import { databaseAccepted, databaseIsolationAccepted } from '../../src/check-database-role';
import { DatabaseProbe } from '../../src/platform/persistence/database-probe';
import { PrismaRoot } from '../../src/platform/persistence/prisma-root';
import { Tenant } from '../../src/platform/tenant-context/tenant.decorator';
import {
  NestedUnitOfWorkError,
  NoUnitOfWorkError,
  TenantGuardError,
  TenantMismatchError,
  TransactionConflictError,
  UnmintedTenantContextError,
} from '../../src/platform/unit-of-work/errors';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
  type UnitOfWorkOptions,
} from '../../src/platform/unit-of-work/unit-of-work';
import { createTestApp } from '../support/test-app';
import { testAppConfig, TEST_TENANTS } from '../support/test-config';
import {
  createPersistence,
  otherTenantOf,
  probeRow,
  recordDriverStatements,
  tenantOf,
  uniqueLabel,
  type Persistence,
} from './persistence-support';
import {
  lockingOwnerTestDatabaseUrl,
  lockingTestDatabaseUrl,
  ownerTestDatabaseUrl,
  testDatabaseUrl,
} from './test-database';

// The UnitOfWork (ported from Mondapac's platform persistence design, "P", 3) with the session
// statements of row-level security, for both tenant fixtures. Everything runs as the
// application role on the run's locking database, a copy only this file uses: it adds
// test-only triggers that raise serialisation failures.

/** Labels the test-only trigger turns into a serialisation failure. */
const CONFLICT_LABEL_PREFIX = 'conflict-';

const TEST_ONLY_TRIGGERS = `
CREATE FUNCTION platform.zz_test_raise_serialization_failure() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'test-only serialization failure' USING ERRCODE = '40001';
END $$;
CREATE TRIGGER zz_test_conflict BEFORE INSERT ON platform.isolation_probe
  FOR EACH ROW WHEN (NEW.label LIKE '${CONFLICT_LABEL_PREFIX}%')
  EXECUTE FUNCTION platform.zz_test_raise_serialization_failure();`;

const DROP_TEST_ONLY_TRIGGERS = `
DROP TRIGGER IF EXISTS zz_test_conflict ON platform.isolation_probe;
DROP FUNCTION IF EXISTS platform.zz_test_raise_serialization_failure();`;

/** Unit work with nothing to await; a throw inside it becomes a rejection, as in async work. */
const inline =
  <T>(work: () => T): (() => Promise<T>) =>
  () =>
    Promise.resolve().then(work);

/** The first words of a statement: its kind, without tables, columns or parameters. */
function statementKind(sql: string): string {
  const text = sql.trim().replace(/\s+/g, ' ');
  if (/^SET TRANSACTION /i.test(text) || /^SET LOCAL /i.test(text)) return text;
  if (/set_config\(/.test(text)) return 'SET TENANT';
  return /^(\w+)/.exec(text)?.[1]?.toUpperCase() ?? '';
}

describe('UnitOfWork (database integration)', () => {
  let db: Persistence;
  let driver: ReturnType<typeof recordDriverStatements>;
  let owner: Client;

  beforeAll(async () => {
    driver = recordDriverStatements();
    db = createPersistence({ databaseUrl: lockingTestDatabaseUrl() });
    owner = new Client({ connectionString: lockingOwnerTestDatabaseUrl() });
    await owner.connect();
    await owner.query(TEST_ONLY_TRIGGERS);
  });

  afterAll(async () => {
    await owner.query(DROP_TEST_ONLY_TRIGGERS);
    await owner.end();
    await db.close();
    driver.restore();
  });

  /** Whether a row exists, read by the owner (not subject to row-level security). */
  const rowExists = async (id: string): Promise<boolean> =>
    (await owner.query('SELECT 1 FROM platform.isolation_probe WHERE id = $1', [id])).rowCount ===
    1;

  const insert = (tenant: TenantContext, row: ReturnType<typeof probeRow>) =>
    db.service.tx(tenant).isolationProbe.create({ data: row });

  describe.each(TEST_TENANTS)('in a unit for %s', (code) => {
    const tenant = tenantOf(code);
    const other = tenantOf(otherTenantOf(code));

    describe('commit rule (P 3.1 row 3)', () => {
      it('commits an ok result', async () => {
        const row = probeRow(tenant);
        const result = await db.unitOfWork.run(tenant, async () => {
          await insert(tenant, row);
          return ok('saved');
        });

        expect(result).toEqual({ ok: true, value: 'saved' });
        await expect(rowExists(row.id)).resolves.toBe(true);
      });

      it('commits nothing for an err result and returns it unchanged', async () => {
        const row = probeRow(tenant);
        const refusal = { code: 'test.refused' } as const;
        const result = await db.unitOfWork.run(tenant, async () => {
          await insert(tenant, row);
          return err(refusal);
        });

        expect(result).toEqual({ ok: false, error: refusal });
        await expect(rowExists(row.id)).resolves.toBe(false);
      });

      it('commits nothing when work throws, and rethrows the error', async () => {
        const row = probeRow(tenant);
        const failure = new Error('work failed');
        const run = db.unitOfWork.run(tenant, async () => {
          await insert(tenant, row);
          throw failure;
        });

        await expect(run).rejects.toBe(failure);
        await expect(rowExists(row.id)).resolves.toBe(false);
      });
    });

    describe('the open unit and its tenant (P 3.1 rows 2 and 4, 3.3)', () => {
      it('refuses a TenantContext that was not minted', async () => {
        const forged = { tenantId: tenant.tenantId } as TenantContext;

        await expect(db.unitOfWork.run(forged, () => Promise.resolve(ok(1)))).rejects.toThrow(
          UnmintedTenantContextError,
        );
      });

      it("refuses the other fixture's context in this unit (tx(tenant) mismatch)", async () => {
        const run = db.unitOfWork.run(
          tenant,
          inline(() => {
            db.service.tx(other);
            return ok(undefined);
          }),
        );

        await expect(run).rejects.toThrow(TenantMismatchError);
      });

      it('throws NoUnitOfWorkError for tx(tenant) with no open unit', () => {
        expect(() => db.service.tx(tenant)).toThrow(NoUnitOfWorkError);
      });

      it.each<[UnitOfWorkOptions, UnitOfWorkOptions]>([
        [{}, {}],
        [{}, { readOnly: true }],
        [{ readOnly: true }, {}],
      ])('throws NestedUnitOfWorkError for a unit %j inside a unit %j', async (inner, outer) => {
        const run = db.unitOfWork.run(
          tenant,
          async () => {
            await db.unitOfWork.run(tenant, () => Promise.resolve(ok(undefined)), inner);
            return ok(undefined);
          },
          outer,
        );

        await expect(run).rejects.toThrow(NestedUnitOfWorkError);
      });

      it('refuses a query started inside a unit and awaited after it ends', async () => {
        const row = probeRow(tenant);
        let late: Promise<unknown> | undefined;

        await db.unitOfWork.run(
          tenant,
          inline(() => {
            late = db.service.tx(tenant).isolationProbe.create({ data: row });
            return ok(undefined);
          }),
        );

        await expect(late).rejects.toThrow(TenantGuardError);
        await expect(rowExists(row.id)).resolves.toBe(false);
      });
    });

    describe('session statements (ADR-02)', () => {
      const read = async () =>
        ok(await db.service.tx(tenant).isolationProbe.count({ where: { tenantId: code } }));

      it('sets the tenant first in a read-write unit, and sends no isolation for the default', async () => {
        await driver.during(() => db.unitOfWork.run(tenant, read));

        expect(driver.statements.map(statementKind)).toEqual([
          'BEGIN',
          'SET TENANT',
          'SELECT',
          'COMMIT',
        ]);
      });

      it('sends Serializable when asked, before the tenant setting', async () => {
        await driver.during(() => db.unitOfWork.run(tenant, read, { isolation: 'serializable' }));

        expect(driver.statements.map(statementKind)).toEqual([
          'BEGIN',
          'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
          'SET TENANT',
          'SELECT',
          'COMMIT',
        ]);
      });

      it('opens a read-only unit as a READ ONLY transaction', async () => {
        await driver.during(() => db.unitOfWork.run(tenant, read, { readOnly: true }));

        expect(driver.statements.map(statementKind)).toEqual([
          'BEGIN',
          'SET TRANSACTION READ ONLY',
          'SET TENANT',
          'SELECT',
          'COMMIT',
        ]);
      });

      it('issues SET LOCAL lock_timeout after the tenant when asked', async () => {
        await driver.during(() => db.unitOfWork.run(tenant, read, { lockTimeoutMs: 250 }));

        expect(driver.statements.map(statementKind)).toEqual([
          'BEGIN',
          'SET TENANT',
          "SET LOCAL lock_timeout = '250ms'",
          'SELECT',
          'COMMIT',
        ]);
      });

      it('passes the tenant as a parameter, never in the text', async () => {
        await driver.during(() => db.unitOfWork.run(tenant, read));

        const setTenant = driver.statements.find((sql) => sql.includes('set_config'));
        expect(setTenant).toBeDefined();
        expect(setTenant).not.toContain(code);
      });

      it('refuses a write in a read-only unit (guard), so nothing reaches the database', async () => {
        const row = probeRow(tenant);
        const run = db.unitOfWork.run(tenant, async () => ok(await insert(tenant, row)), {
          readOnly: true,
        });

        await expect(run).rejects.toThrow(TenantGuardError);
        await expect(rowExists(row.id)).resolves.toBe(false);
      });
    });

    describe('retry (P 3.1 row 7)', () => {
      it('retries a serialisation failure three times in all, then answers a conflict', async () => {
        let attempts = 0;
        const run = db.unitOfWork.run(tenant, async () => {
          attempts += 1;
          await insert(tenant, probeRow(tenant, { label: uniqueLabel('conflict') }));
          return ok(undefined);
        });

        await expect(run).rejects.toEqual(new TransactionConflictError('40001'));
        expect(attempts).toBe(3);
      });

      it('runs a read-only unit once: a conflict is not retried', async () => {
        let attempts = 0;
        const run = db.unitOfWork.run(
          tenant,
          async () => {
            attempts += 1;
            // A read-only unit cannot write, so the failure is raised by the database on read.
            await db.service
              .tx(tenant)
              .isolationProbe.findMany({ where: { tenantId: code, label: 'no-such-row' } });
            throw Object.assign(new Error('simulated'), {
              cause: { originalCode: '40001' },
            });
          },
          { readOnly: true },
        );

        await expect(run).rejects.toThrow();
        expect(attempts).toBe(1);
      });

      it('succeeds on a later attempt once the conflict is gone', async () => {
        let attempts = 0;
        const final = probeRow(tenant);
        const result = await db.unitOfWork.run(tenant, async () => {
          attempts += 1;
          const label = attempts === 1 ? uniqueLabel('conflict') : final.label;
          await insert(tenant, { ...final, label });
          return ok(attempts);
        });

        expect(result).toEqual({ ok: true, value: 2 });
        await expect(rowExists(final.id)).resolves.toBe(true);
      });
    });
  });
});

describe('start-up self-checks (database integration)', () => {
  const quiet = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };

  it('accepts the application login on the run database', async () => {
    const root = new PrismaRoot(testAppConfig({ DATABASE_URL: testDatabaseUrl() }));
    try {
      const probe = new DatabaseProbe(root);
      await expect(probe.roleProblems()).resolves.toEqual([]);
      await expect(databaseAccepted(probe, quiet)).resolves.toBe(true);
      await expect(databaseIsolationAccepted(probe, quiet)).resolves.toBe(true);
    } finally {
      await root.$disconnect();
    }
  });

  it('refuses the migration role (the owner) with stable reason codes', async () => {
    const root = new PrismaRoot(testAppConfig({ DATABASE_URL: ownerTestDatabaseUrl() }));
    try {
      const problems = await new DatabaseProbe(root).roleProblems();
      const codes = new Set(problems.map((problem) => problem.code));
      expect(codes.has('role_attribute')).toBe(true);
      expect(codes.has('owner_membership')).toBe(true);
      expect(codes.has('role_timeouts')).toBe(true);
    } finally {
      await root.$disconnect();
    }
  });
});

@Controller('test/uow')
class UnitOfWorkController {
  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  @Get('conflict')
  async conflict(@Tenant() tenant: TenantContext): Promise<void> {
    await this.unitOfWork.run(tenant, () => {
      throw new TransactionConflictError('40001');
    });
  }
}

describe('HTTP over a real database', () => {
  it.each(TEST_TENANTS)(
    'answers /health/ready with 200 and a conflict with 409 conflict.retry (%s)',
    async (code) => {
      const { app } = await createTestApp({
        env: { DATABASE_URL: testDatabaseUrl() },
        controllers: [UnitOfWorkController],
      });
      try {
        await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ok' });
        const response = await request(app.getHttpServer())
          .get('/test/uow/conflict')
          .set('x-tenant-id', code)
          .expect(409);
        expect(response.body).toEqual({ statusCode: 409, code: 'conflict.retry' });
      } finally {
        await app.close();
      }
    },
  );
});
