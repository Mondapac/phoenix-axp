import { randomBytes } from 'node:crypto';
import { Temporal } from '@phoenix/shared-kernel';
import type { Id, TenantContext } from '@phoenix/shared-kernel';
import { testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import {
  SealedValueError,
  SubjectKeyCipher,
  SubjectKeysUnavailableError,
  WRAPPED_KEY_BYTES,
} from './subject-key-cipher';
import type { SubjectKeyStore } from './subject-key-store';
import { SubjectKeyService } from './subject-key.service';

// Per-subject keys (ADR-0003, ADR-0007): data sealed for one subject opens only for that
// subject and tenant, under the deployment's KEK, and never once the key is destroyed.

const subject = (n: number) =>
  `01990000-0000-7000-8000-${String(n).padStart(12, '0')}` as Id<string>;

/** The store in memory, as the Prisma store behaves in a unit. */
class MemoryStore implements SubjectKeyStore {
  readonly rows = new Map<string, Uint8Array | null>();
  insert(tenant: TenantContext, key: { subjectId: Id<string>; wrappedKey: Uint8Array }) {
    this.rows.set(`${tenant.tenantId}/${key.subjectId}`, key.wrappedKey);
    return Promise.resolve();
  }
  wrappedKeys(tenant: TenantContext, ids: readonly Id<string>[]) {
    const found = new Map<string, Uint8Array | null>();
    for (const id of ids) {
      const row = this.rows.get(`${tenant.tenantId}/${id}`);
      if (row !== undefined) found.set(id, row);
    }
    return Promise.resolve(found);
  }
  destroy(tenant: TenantContext, id: Id<string>) {
    const key = `${tenant.tenantId}/${id}`;
    const live = this.rows.get(key) != null;
    if (live) this.rows.set(key, null);
    return Promise.resolve(live);
  }
}

describe.each(TEST_TENANTS)('SubjectKeyService in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const other = testTenantContext(TEST_TENANTS.find((c) => c !== code)!);
  const kek = randomBytes(32);
  const at = Temporal.Instant.from('2026-10-27T20:00:00Z');
  const plaintext = Buffer.from('{"name":"زهرا"}', 'utf8');

  it('seals and opens a subject’s data; the plaintext is not in the sealed bytes', async () => {
    const store = new MemoryStore();
    const service = new SubjectKeyService(new SubjectKeyCipher(kek), store);
    const sealed = service.seal(tenant, subject(1), plaintext);
    expect(sealed.wrappedKey).toHaveLength(WRAPPED_KEY_BYTES);
    expect(sealed.ciphertext.includes(plaintext)).toBe(false);
    await service.store(tenant, subject(1), 'forms', sealed.wrappedKey, at);
    const keys = await service.wrappedKeys(tenant, [subject(1)]);
    expect(service.open(tenant, subject(1), keys.get(subject(1)), sealed.ciphertext)).toEqual(
      plaintext,
    );
  });

  it('does not open for another subject, another tenant, another KEK or altered bytes', () => {
    const cipher = new SubjectKeyCipher(kek);
    const service = new SubjectKeyService(cipher, new MemoryStore());
    const sealed = service.seal(tenant, subject(1), plaintext);
    expect(() => service.open(tenant, subject(2), sealed.wrappedKey, sealed.ciphertext)).toThrow(
      SealedValueError,
    );
    expect(() => service.open(other, subject(1), sealed.wrappedKey, sealed.ciphertext)).toThrow(
      SealedValueError,
    );
    const foreign = new SubjectKeyService(new SubjectKeyCipher(randomBytes(32)), new MemoryStore());
    expect(() => foreign.open(tenant, subject(1), sealed.wrappedKey, sealed.ciphertext)).toThrow(
      SealedValueError,
    );
    const altered = Buffer.from(sealed.ciphertext);
    altered[altered.length - 1]! ^= 1;
    expect(() => service.open(tenant, subject(1), sealed.wrappedKey, altered)).toThrow(
      SealedValueError,
    );
  });

  it('answers null once the key is destroyed (erasure)', async () => {
    const store = new MemoryStore();
    const service = new SubjectKeyService(new SubjectKeyCipher(kek), store);
    const sealed = service.seal(tenant, subject(3), plaintext);
    await service.store(tenant, subject(3), 'forms', sealed.wrappedKey, at);
    await expect(service.destroy(tenant, subject(3), at)).resolves.toBe(true);
    await expect(service.destroy(tenant, subject(3), at)).resolves.toBe(false);
    const keys = await service.wrappedKeys(tenant, [subject(3)]);
    expect(service.open(tenant, subject(3), keys.get(subject(3)), sealed.ciphertext)).toBeNull();
  });

  it('reseals new data under the same key, never under a destroyed one', () => {
    const service = new SubjectKeyService(new SubjectKeyCipher(kek), new MemoryStore());
    const sealed = service.seal(tenant, subject(4), plaintext);
    const changed = Buffer.from('{"name":"مریم"}', 'utf8');
    const resealed = service.reseal(tenant, subject(4), sealed.wrappedKey, changed);
    expect(resealed.includes(changed)).toBe(false);
    expect(service.open(tenant, subject(4), sealed.wrappedKey, resealed)).toEqual(changed);
    expect(() => service.reseal(tenant, subject(5), sealed.wrappedKey, changed)).toThrow(
      SealedValueError,
    );
    expect(() => service.reseal(tenant, subject(4), null, changed)).toThrow();
  });

  it('refuses everything without a KEK (fail closed)', () => {
    const service = new SubjectKeyService(new SubjectKeyCipher(null), new MemoryStore());
    expect(service.available).toBe(false);
    expect(() => service.seal(tenant, subject(1), plaintext)).toThrow(SubjectKeysUnavailableError);
    expect(() => new SubjectKeyCipher(randomBytes(16))).toThrow(TypeError);
  });
});
