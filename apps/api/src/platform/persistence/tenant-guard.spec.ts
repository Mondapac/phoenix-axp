import { testTenantContext } from '@phoenix/shared-kernel/testing';
import { Prisma } from '../../generated/prisma/client';
import type { TenantGuardRefusal } from '../unit-of-work/errors';
import type { ModelMap, ModelMapEntry } from './model-map';
import { lockTimeoutStatement, readOnlyStatement, setTenantStatement } from './session-statements';
import { tenantGuardRefusal, type GuardUnit } from './tenant-guard';

// P 4.1: the guard's decision as a pure function of (map entry, operation, arguments, open
// unit), for both tenant fixtures. No database, no Nest.

function entry(overrides: Partial<ModelMapEntry>): ModelMapEntry {
  return {
    module: 'alpha',
    schema: 'alpha',
    table: 't',
    clientProperty: 'x',
    scope: 'scoped',
    scalarFields: ['id', 'tenantId'],
    relationFields: [],
    idField: 'id',
    compoundSelectors: [],
    foreignKeys: [],
    ...overrides,
  };
}

const MAP: ModelMap = {
  models: {
    Page: entry({
      scalarFields: ['id', 'tenantId', 'slug', 'title'],
      relationFields: ['blocks'],
      compoundSelectors: [
        { name: 'tenantId_slug', fields: ['tenantId', 'slug'] },
        { name: 'bySlug', fields: ['slug', 'tenantId'] },
      ],
    }),
    Block: entry({ scalarFields: ['id', 'tenantId', 'pageId'], relationFields: ['page'] }),
    Lookup: entry({ scope: 'exempt', scalarFields: ['code', 'label'], idField: 'code' }),
    Broken: entry({ scope: 'invalid' }),
  },
  modules: {},
};

const TENANTS = ['demo-fa', 'demo-en'] as const;

describe.each(TENANTS)('tenant guard decision, unit opened for %s', (code) => {
  const tenant = testTenantContext(code);
  const T = tenant.tenantId as string;
  const other = code === 'demo-fa' ? 'demo-en' : 'demo-fa';
  const unit: GuardUnit = { tenant, readOnly: false, closed: false };
  const readOnlyUnit: GuardUnit = { tenant, readOnly: true, closed: false };

  const decide = (
    model: string | undefined,
    operation: string,
    args: unknown,
    open: GuardUnit | 'no unit' = unit,
  ): TenantGuardRefusal | null =>
    tenantGuardRefusal(MAP, { model, operation, args }, open === 'no unit' ? undefined : open);

  describe('the open unit', () => {
    it('refuses any model operation with no open unit, or a closed one', () => {
      expect(decide('Page', 'findMany', { where: { tenantId: T } }, 'no unit')).toBe(
        'no-open-unit',
      );
      expect(
        decide('Page', 'findMany', { where: { tenantId: T } }, { ...unit, closed: true }),
      ).toBe('unit-closed');
    });

    it('refuses a model the map does not know, and a model whose scope is invalid', () => {
      expect(decide('Unknown', 'findMany', { where: { tenantId: T } })).toBe('unknown-model');
      expect(decide('Broken', 'findMany', { where: { tenantId: T } })).toBe('unknown-model');
    });

    it.each(['aggregateRaw', 'findRaw', 'runCommandRaw', 'somethingNew', 'createOne'])(
      'refuses the unrecognised operation %s',
      (operation) => {
        expect(decide('Page', operation, { where: { tenantId: T } })).toBe('unknown-operation');
      },
    );

    it('refuses any other client operation with no model', () => {
      expect(decide(undefined, '$somethingNew', {})).toBe('unknown-operation');
    });

    it('refuses every write in a read-only unit', () => {
      expect(decide('Page', 'findMany', { where: { tenantId: T } }, readOnlyUnit)).toBeNull();
      expect(decide('Page', 'create', { data: { tenantId: T } }, readOnlyUnit)).toBe(
        'write-in-read-only-unit',
      );
      expect(decide('Page', 'deleteMany', { where: { tenantId: T } }, readOnlyUnit)).toBe(
        'write-in-read-only-unit',
      );
    });
  });

  describe('raw SQL and the session statements', () => {
    const setTenant = setTenantStatement(tenant);
    const setOther = setTenantStatement(testTenantContext(other));

    it.each(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', '$queryRawTyped'])(
      'refuses arbitrary raw SQL (%s), inside a unit and outside one',
      (operation) => {
        expect(decide(undefined, operation, Prisma.sql`SELECT 1`)).toBe('raw-sql');
        expect(decide(undefined, operation, {})).toBe('raw-sql');
        expect(decide(undefined, operation, {}, 'no unit')).toBe('raw-sql');
      },
    );

    it("lets the unit's own tenant setting through $queryRaw, in both kinds of unit", () => {
      expect(decide(undefined, '$queryRaw', setTenant)).toBeNull();
      expect(decide(undefined, '$queryRaw', setTenant, readOnlyUnit)).toBeNull();
    });

    it('refuses the setting of another tenant, and a hand-built variant of the text', () => {
      expect(decide(undefined, '$queryRaw', setOther)).toBe('raw-sql');
      expect(
        decide(
          undefined,
          '$queryRaw',
          Prisma.sql`SELECT pg_catalog.set_config('app.tenant_id', ${T}, false)`,
        ),
      ).toBe('raw-sql');
      expect(
        decide(
          undefined,
          '$queryRaw',
          Prisma.sql`SELECT pg_catalog.set_config(${'app.other'}, ${T}, true)`,
        ),
      ).toBe('raw-sql');
    });

    it('lets READ ONLY and a bounded lock timeout through $executeRaw only', () => {
      expect(decide(undefined, '$executeRaw', readOnlyStatement())).toBeNull();
      expect(decide(undefined, '$executeRaw', lockTimeoutStatement(100))).toBeNull();
      expect(decide(undefined, '$queryRaw', readOnlyStatement())).toBe('raw-sql');
      expect(decide(undefined, '$executeRaw', setTenant)).toBe('raw-sql');
      expect(
        decide(undefined, '$executeRaw', Prisma.raw("SET LOCAL lock_timeout = '9000ms'")),
      ).toBe('raw-sql');
    });

    it.each(['$queryRawUnsafe', '$executeRawUnsafe', '$queryRawTyped'])(
      'refuses %s even with a session statement',
      (operation) => {
        expect(decide(undefined, operation, setTenant)).toBe('raw-sql');
        expect(decide(undefined, operation, readOnlyStatement())).toBe('raw-sql');
      },
    );

    it('refuses a session statement with no unit and in a closed unit', () => {
      expect(decide(undefined, '$queryRaw', setTenant, 'no unit')).toBe('raw-sql');
      expect(decide(undefined, '$queryRaw', setTenant, { ...unit, closed: true })).toBe('raw-sql');
    });
  });

  describe('where: top-level tenantId equal to the unit tenant (P 4.1 row 1)', () => {
    const READS = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'];
    const WRITES = ['update', 'updateMany', 'delete', 'deleteMany'];
    const withData = (operation: string, where: unknown) =>
      operation.startsWith('update') ? { where, data: { title: 't' } } : { where };

    it.each([...READS, ...WRITES])('%s: accepts the plain value and { equals }', (operation) => {
      expect(decide('Page', operation, withData(operation, { tenantId: T, id: 'x' }))).toBeNull();
      expect(
        decide('Page', operation, withData(operation, { tenantId: { equals: T } })),
      ).toBeNull();
    });

    it.each([...READS, ...WRITES])('%s: refuses no where, or a where without tenantId', (op) => {
      expect(decide('Page', op, {})).toBe('where-missing');
      expect(decide('Page', op, { where: { id: 'x' } })).toBe('where-tenant-missing');
    });

    it.each([...READS, ...WRITES])("%s: refuses the other fixture's tenant", (op) => {
      expect(decide('Page', op, { where: { tenantId: other } })).toBe('where-tenant-mismatch');
    });

    it.each([
      ['{ equals, mode }', { equals: T, mode: 'insensitive' }],
      ['{ in }', { in: [T] }],
      ['{ not }', { not: other }],
      ['null', null],
      ['an array', [T]],
    ])('refuses tenantId as %s', (_case, value) => {
      expect(decide('Page', 'findMany', { where: { tenantId: value } })).toBe(
        'where-tenant-mismatch',
      );
    });

    it('does not count tenantId inside OR, AND or NOT', () => {
      for (const where of [{ OR: [{ tenantId: T }] }, { AND: [{ tenantId: T }] }]) {
        expect(decide('Page', 'findMany', { where })).toBe('where-tenant-missing');
      }
    });

    it('refuses an unknown where key', () => {
      expect(decide('Page', 'findMany', { where: { tenantId: T, tenant_id: T } })).toBe(
        'where-unknown-key',
      );
    });

    it('lets an exempt model read without a where', () => {
      expect(decide('Lookup', 'findMany', {})).toBeNull();
    });
  });

  describe('compound selectors and cursors (P 4.1 rows 2 and 3)', () => {
    it("accepts the unit's tenant in a selector, in either field order", () => {
      for (const name of ['tenantId_slug', 'bySlug']) {
        expect(
          decide('Page', 'findUnique', {
            where: { tenantId: T, [name]: { tenantId: T, slug: 's' } },
          }),
        ).toBeNull();
        expect(
          decide('Page', 'findUnique', {
            where: { tenantId: T, [name]: { tenantId: other, slug: 's' } },
          }),
        ).toBe('selector-tenant-mismatch');
      }
    });

    it('refuses a selector that is not an object', () => {
      expect(decide('Page', 'findUnique', { where: { tenantId: T, tenantId_slug: 'x' } })).toBe(
        'selector-malformed',
      );
    });

    it('reads a cursor as a where of its own', () => {
      const where = { tenantId: T };
      expect(decide('Page', 'findMany', { where, cursor: { tenantId: T, id: 'x' } })).toBeNull();
      expect(decide('Page', 'findMany', { where, cursor: { id: 'x' } })).toBe(
        'cursor-tenant-missing',
      );
      expect(decide('Page', 'findMany', { where, cursor: { tenantId: other, id: 'x' } })).toBe(
        'cursor-tenant-mismatch',
      );
    });
  });

  describe('writes (P 4.1 rows 4 to 8)', () => {
    it("creates rows of the unit's tenant only", () => {
      expect(decide('Page', 'create', { data: { tenantId: T, slug: 's' } })).toBeNull();
      expect(decide('Page', 'createMany', { data: [{ tenantId: T }, { tenantId: T }] })).toBeNull();
      expect(decide('Page', 'create', { data: { slug: 's' } })).toBe('data-tenant-mismatch');
      expect(decide('Page', 'createMany', { data: [{ tenantId: T }, { tenantId: other }] })).toBe(
        'data-tenant-mismatch',
      );
      expect(decide('Page', 'createMany', { data: [] })).toBe('data-missing');
    });

    it('refuses a nested write', () => {
      expect(decide('Page', 'create', { data: { tenantId: T, blocks: { create: [] } } })).toBe(
        'nested-write',
      );
      expect(
        decide('Page', 'update', { where: { tenantId: T }, data: { blocks: { create: [] } } }),
      ).toBe('nested-write');
    });

    it('refuses an update that changes the tenant', () => {
      expect(decide('Page', 'update', { where: { tenantId: T }, data: { tenantId: T } })).toBe(
        'data-changes-tenant',
      );
    });

    it('accepts an upsert by a tenant selector only', () => {
      const create = { tenantId: T, slug: 's' };
      expect(
        decide('Page', 'upsert', {
          where: { tenantId: T, tenantId_slug: { tenantId: T, slug: 's' } },
          create,
          update: { title: 't' },
        }),
      ).toBeNull();
      expect(
        decide('Page', 'upsert', { where: { tenantId: T, id: 'x' }, create, update: {} }),
      ).toBe('upsert-by-id');
      expect(
        decide('Block', 'upsert', { where: { tenantId: T }, create: { tenantId: T }, update: {} }),
      ).toBe('upsert-without-tenant-selector');
    });
  });
});
