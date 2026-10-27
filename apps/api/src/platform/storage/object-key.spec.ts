import { Temporal } from '@phoenix/shared-kernel';
import type { Id } from '@phoenix/shared-kernel';
import { FixedClock, SequenceIdGenerator, testTenantContext } from '@phoenix/shared-kernel/testing';
import { objectKey } from './object-key';

const ids = new SequenceIdGenerator(new FixedClock(Temporal.Instant.from('2026-10-27T10:00:00Z')));

describe('objectKey', () => {
  it('builds <tenant>/<module>/<id> from a minted tenant and a parsed id', () => {
    const id = ids.next<'File'>();

    expect(objectKey(testTenantContext('acme-gov'), 'forms', id)).toBe(`acme-gov/forms/${id}`);
  });

  it('gives two tenants different keys for the same id', () => {
    const id = ids.next<'File'>();

    expect(objectKey(testTenantContext('tenant-a'), 'forms', id)).not.toBe(
      objectKey(testTenantContext('tenant-b'), 'forms', id),
    );
  });

  it.each(['Forms', 'forms/../x', '', 'f', 'a'.repeat(33), '../other-tenant'])(
    'throws on the module name %p',
    (module) => {
      expect(() => objectKey(testTenantContext('acme-gov'), module, ids.next())).toThrow(TypeError);
    },
  );

  it.each(['../../x', 'photo.png', ''])('throws on an id that is not a parsed id: %p', (id) => {
    expect(() => objectKey(testTenantContext('acme-gov'), 'forms', id as Id<'File'>)).toThrow(
      TypeError,
    );
  });
});
