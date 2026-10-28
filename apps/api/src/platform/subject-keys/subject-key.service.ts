import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { SubjectKeyCipher } from './subject-key-cipher';
import type { SubjectKeyStore } from './subject-key-store';

/** A subject's data, encrypted under a new data key, with that key wrapped under the KEK. */
export interface SealedSubjectData {
  readonly wrappedKey: Buffer;
  readonly ciphertext: Buffer;
}

/**
 * `SubjectKeyService` (ADR-0003, ADR-0007): personal data is encrypted under a key of its own
 * subject, and erasure destroys the key. The cryptography is CPU work and runs outside the
 * unit of work; the key rows are written and read inside it:
 *
 * - write: `seal` before the unit, then `store` in the unit that inserts the record;
 * - read: `wrappedKeys` in the unit that reads the records, then `open` after it;
 * - erase: `destroy` in a unit; what was sealed under the key can no longer be opened.
 *
 * The plain data key never leaves this class; nothing here is logged.
 */
export class SubjectKeyService {
  constructor(
    private readonly cipher: SubjectKeyCipher,
    private readonly keys: SubjectKeyStore,
  ) {}

  /** False when no KEK is configured: `seal` and `open` throw. */
  get available(): boolean {
    return this.cipher.available;
  }

  seal(tenant: TenantContext, subjectId: Id<string>, plaintext: Uint8Array): SealedSubjectData {
    const { dataKey, wrapped } = this.cipher.newKey(tenant, subjectId);
    try {
      return {
        wrappedKey: wrapped,
        ciphertext: this.cipher.encrypt(dataKey, tenant, subjectId, plaintext),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * New ciphertext under the subject's existing key, for a record whose sealed data changes
   * (an Object record update, ADR-0017): the key stays, so erasure still destroys one key.
   * Throws when the key was destroyed (`wrappedKey` null): erased data is never written again.
   */
  reseal(
    tenant: TenantContext,
    subjectId: Id<string>,
    wrappedKey: Uint8Array | null | undefined,
    plaintext: Uint8Array,
  ): Buffer {
    if (wrappedKey === null || wrappedKey === undefined) {
      throw new Error('subject-keys: the subject key was destroyed or never stored');
    }
    const dataKey = this.cipher.unwrap(tenant, subjectId, wrappedKey);
    try {
      return this.cipher.encrypt(dataKey, tenant, subjectId, plaintext);
    } finally {
      dataKey.fill(0);
    }
  }

  /** In the caller's unit, with the record the key protects. */
  store(
    tenant: TenantContext,
    subjectId: Id<string>,
    module: string,
    wrappedKey: Uint8Array,
    at: Temporal.Instant,
  ): Promise<void> {
    return this.keys.insert(tenant, { subjectId, module, wrappedKey }, at);
  }

  /** In the caller's unit. */
  wrappedKeys(
    tenant: TenantContext,
    subjectIds: readonly Id<string>[],
  ): Promise<ReadonlyMap<string, Uint8Array | null>> {
    return this.keys.wrappedKeys(tenant, subjectIds);
  }

  /** In the caller's unit. */
  destroy(tenant: TenantContext, subjectId: Id<string>, at: Temporal.Instant): Promise<boolean> {
    return this.keys.destroy(tenant, subjectId, at);
  }

  /**
   * The plaintext, or `null` when the key was destroyed or never stored (erased data). Throws
   * `SealedValueError` when the bytes do not open: tampering is never answered as erasure.
   */
  open(
    tenant: TenantContext,
    subjectId: Id<string>,
    wrappedKey: Uint8Array | null | undefined,
    ciphertext: Uint8Array,
  ): Buffer | null {
    if (wrappedKey === null || wrappedKey === undefined) return null;
    const dataKey = this.cipher.unwrap(tenant, subjectId, wrappedKey);
    try {
      return this.cipher.decrypt(dataKey, tenant, subjectId, ciphertext);
    } finally {
      dataKey.fill(0);
    }
  }
}

export const SUBJECT_KEY_SERVICE = Symbol('SUBJECT_KEY_SERVICE');
