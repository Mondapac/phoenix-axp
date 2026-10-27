import { ok } from '@phoenix/shared-kernel';
import { AUDIT_PROPERTIES } from '../../src/platform/persistence/guarded-client';
import { TenantGuardError } from '../../src/platform/unit-of-work/errors';
import { TEST_TENANTS } from '../support/test-config';
import {
  createPersistence,
  modelMap,
  otherTenantOf,
  probeRow,
  tenantOf,
  type Persistence,
} from './persistence-support';

// The tenant guard (P 4) on a real database, both fixtures: what the guard refuses never
// reaches the database, and what it lets through is still filtered by row-level security.

describe('tenant guard (database integration)', () => {
  let db: Persistence;

  beforeAll(() => {
    db = createPersistence();
  });

  afterAll(async () => {
    await db.close();
  });

  describe.each(TEST_TENANTS)('in a unit for %s', (code) => {
    const tenant = tenantOf(code);
    const otherCode = otherTenantOf(code);
    const other = tenantOf(otherCode);

    const inUnit = <T>(work: () => Promise<T>) =>
      db.unitOfWork.run(tenant, async () => ok(await work()));

    it('writes and reads back a row of its own tenant', async () => {
      const row = probeRow(tenant);
      const found = await inUnit(async () => {
        await db.service.tx(tenant).isolationProbe.create({ data: row });
        return db.service.tx(tenant).isolationProbe.findMany({
          where: { tenantId: code, label: row.label },
          select: { id: true, tenantId: true },
        });
      });

      expect(found).toEqual({ ok: true, value: [{ id: row.id, tenantId: code }] });
    });

    it.each([
      ['a where without tenantId', { where: {} }, 'where-tenant-missing'],
      [
        'the other tenant in the where',
        { where: { tenantId: otherCode } },
        'where-tenant-mismatch',
      ],
      ['no where at all', {}, 'where-missing'],
    ])('refuses %s before it reaches the database', async (_case, args, reason) => {
      const run = inUnit(() =>
        db.service.tx(tenant).isolationProbe.findMany(args as { where: { tenantId: string } }),
      );

      await expect(run).rejects.toMatchObject({ name: 'TenantGuardError', reason });
    });

    it('refuses to create a row of the other tenant', async () => {
      const run = inUnit(() =>
        db.service.tx(tenant).isolationProbe.create({ data: probeRow(other) }),
      );

      await expect(run).rejects.toThrow(TenantGuardError);
    });

    it('hands out a view with no raw SQL and no transaction door', async () => {
      const keys = await inUnit(() => {
        const view = db.service.tx(tenant) as unknown as Record<string, unknown>;
        expect(Object.getPrototypeOf(view)).toBeNull();
        expect(Object.isFrozen(view)).toBe(true);
        return Promise.resolve(Object.keys(view));
      });

      // One delegate per model of the map but the audit tables (only `auditTx` hands those
      // out), and nothing else ($queryRaw, $transaction, ...).
      expect(keys.ok).toBe(true);
      const names = keys.ok ? [...keys.value].sort() : [];
      const audit: readonly string[] = AUDIT_PROPERTIES;
      expect(names).toEqual(
        Object.values(modelMap.models)
          .map((model) => model.clientProperty)
          .filter((property) => !audit.includes(property))
          .sort(),
      );
      expect(names.some((name) => audit.includes(name))).toBe(false);
    });

    it("never sees the other tenant's rows, even by id", async () => {
      const foreign = probeRow(other);
      await db.unitOfWork.run(other, async () =>
        ok(await db.service.tx(other).isolationProbe.create({ data: foreign })),
      );

      const seen = await inUnit(() =>
        db.service
          .tx(tenant)
          .isolationProbe.findMany({ where: { tenantId: code, id: foreign.id } }),
      );
      expect(seen).toEqual({ ok: true, value: [] });
    });
  });
});
