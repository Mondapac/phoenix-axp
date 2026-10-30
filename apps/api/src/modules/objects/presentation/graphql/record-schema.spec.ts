import { err, ok } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { testCallContext, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../../../test/support/test-config';
import { DEFAULT_GRAPHQL_LIMITS, runGraphql } from '../../../../platform/graphql';
import type { ObjectDescription } from '../../application/use-cases/describe-object.use-case';
import { graphqlNameOf, recordSchema, type RecordOperations } from './record-schema';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('graphqlNameOf', () => {
  it('maps every field key to a distinct valid GraphQL name', () => {
    const keys = ['title', 'national-id', 'national-id-2', '2nd-party', 'a', 'f-1x', '1x'];
    const names = keys.map(graphqlNameOf);
    expect(names).toEqual([
      'title',
      'national_id',
      'national_id_2',
      '_2nd_party',
      'a',
      'f_1x',
      '_1x',
    ]);
    expect(new Set(names).size).toBe(keys.length);
    for (const name of names) expect(name).toMatch(/^[_A-Za-z][_0-9A-Za-z]*$/);
    for (const name of names) expect(name.startsWith('__')).toBe(false);
  });
});

describe('recordSchema', () => {
  const object: ObjectDescription = {
    key: 'contracts',
    name: 'قراردادها',
    status: 'published',
    siteId: '01890a5d-ac96-774b-bcce-b302099a8057' as Id<'Site'>,
    revisionNumber: 1,
    fields: [
      {
        key: 'title',
        label: 'عنوان',
        type: 'text',
        required: true,
        read: true,
        create: true,
        update: true,
      },
      {
        key: 'count',
        label: 'تعداد',
        type: 'integer',
        required: false,
        read: true,
        create: true,
        update: true,
      },
      {
        key: 'constructor',
        label: 'سازنده',
        type: 'text',
        required: false,
        read: true,
        create: false,
        update: false,
      },
    ],
  };
  const calls: unknown[] = [];
  const operations: RecordOperations = {
    view: () => Promise.resolve(err({ code: 'objects.record.not-found' })),
    list: () =>
      Promise.resolve(
        ok({
          items: [
            {
              id: ID as Id<'ObjectRecord'>,
              siteId: object.siteId,
              revisionNumber: 1,
              version: 1,
              createdAt: '2026-10-30T00:00:00Z',
              updatedAt: '2026-10-30T00:00:00Z',
              values: { title: 't' },
            },
          ],
          next: null,
        }),
      ),
    create: (_context, input) => {
      calls.push(input);
      return Promise.resolve(ok({ id: 'r', version: 1 }));
    },
    update: () => Promise.resolve(err({ code: 'objects.value.invalid', field: 'count' })),
    remove: (_context, input) => {
      calls.push(input);
      return Promise.resolve(ok(undefined));
    },
  };

  describe.each(TEST_TENANTS)('in tenant %s', (code) => {
    const context = testCallContext(testTenantContext(code), 'system');
    const run = (query: string) =>
      runGraphql(
        () => recordSchema(object, operations),
        { query },
        context,
        { ...DEFAULT_GRAPHQL_LIMITS, introspection: false },
        (error) => {
          throw error;
        },
      );

    beforeEach(() => {
      calls.length = 0;
    });

    it('resolves a field absent from the view to null, whatever its key', async () => {
      const answer = await run('{ records { items { values { title count constructor } } } }');
      expect(answer).toEqual({
        data: { records: { items: [{ values: { title: 't', count: null, constructor: null } }] } },
      });
    });

    it('passes Long input as written, so the use case refuses what it cannot hold', async () => {
      await run('mutation { createRecord(values: { count: 9007199254740993 }) { id } }');
      await run('mutation { createRecord(values: { count: "۱۲" }) { id } }');
      expect(calls).toEqual([
        { siteId: null, values: { count: '9007199254740993' } },
        { siteId: null, values: { count: '۱۲' } },
      ]);
      expect(
        (await run('mutation { createRecord(values: { count: 1.5 }) { id } }')).errors?.[0]
          ?.extensions,
      ).toEqual({ code: 'graphql.invalid' });
    });

    it('answers a use-case failure with its code and the GraphQL name of its field', async () => {
      const answer = await run(
        `mutation { updateRecord(id: "${ID}", version: 1, values: { count: 1 }) { id } }`,
      );
      expect(answer.errors?.[0]?.extensions).toEqual({
        code: 'objects.value.invalid',
        field: 'count',
      });
    });

    it('refuses a malformed site id or version before any use case runs', async () => {
      const site = await run(
        'mutation { createRecord(siteId: "x", values: { title: "t" }) { id } }',
      );
      expect(site.errors?.[0]?.extensions).toEqual({ code: 'request.invalid', field: 'siteId' });
      const list = await run('{ records(site: "x") { next } }');
      expect(list.errors?.[0]?.extensions).toEqual({ code: 'request.invalid', field: 'site' });
      const version = await run(`mutation { deleteRecord(id: "${ID}", version: 0) }`);
      expect(version.errors?.[0]?.extensions).toEqual({
        code: 'request.invalid',
        field: 'version',
      });
      expect(calls).toEqual([]);
    });
  });

  it('offers no RecordInput, createRecord or updateRecord when no field is writable', () => {
    const readOnly = recordSchema(
      { ...object, fields: object.fields.map((f) => ({ ...f, create: false, update: false })) },
      operations,
    );
    expect(readOnly.getType('RecordInput')).toBeUndefined();
    expect(Object.keys(readOnly.getMutationType()!.getFields())).toEqual(['deleteRecord']);
  });
});
