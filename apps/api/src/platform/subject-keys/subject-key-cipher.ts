import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Id, TenantContext } from '@phoenix/shared-kernel';

// The cryptography of per-subject keys (ADR-0003, ADR-0007): AES-256-GCM from node:crypto, no
// dependency. A subject's data key is random; it is stored only wrapped under the
// deployment's key-encryption key (KEK). Both the wrap and the data carry the tenant and the
// subject as associated data, so a wrapped key or a ciphertext copied to another subject or
// tenant does not open. CPU only: callers run it outside their unit of work.

/** The format byte of every sealed value: version 1 = AES-256-GCM, 12-byte IV, 16-byte tag. */
const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;
/** The bytes a sealed value adds to its plaintext. */
export const SEALED_OVERHEAD = 1 + IV_BYTES + TAG_BYTES;
/** The length of a wrapped data key; the migration's CHECK repeats it. */
export const WRAPPED_KEY_BYTES = SEALED_OVERHEAD + KEY_BYTES;

/** Personal data cannot be written or read: no KEK is configured. Answers 503. */
export class SubjectKeysUnavailableError extends Error {
  override readonly name = 'SubjectKeysUnavailableError';
  constructor() {
    super('SUBJECT_KEY_KEK is not configured: personal data can be neither stored nor read');
  }
}

/** A sealed value that does not open: wrong key, wrong subject or tenant, or altered bytes. */
export class SealedValueError extends Error {
  override readonly name = 'SealedValueError';
  constructor() {
    super('A sealed value did not open');
  }
}

const associated = (purpose: string, tenant: TenantContext, subjectId: string): Buffer =>
  Buffer.from(`phoenix:${purpose}:v1\0${tenant.tenantId}\0${subjectId}`, 'utf8');

function seal(key: Buffer, aad: Buffer, plaintext: Uint8Array): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.of(FORMAT), iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, aad: Buffer, sealed: Uint8Array): Buffer {
  const bytes = Buffer.from(sealed);
  if (bytes.length < SEALED_OVERHEAD || bytes[0] !== FORMAT) throw new SealedValueError();
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, SEALED_OVERHEAD);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes.subarray(SEALED_OVERHEAD)), decipher.final()]);
  } catch {
    throw new SealedValueError();
  }
}

/**
 * Wraps and unwraps data keys under the KEK and encrypts a subject's data under its data key.
 * Built with `null` when no KEK is configured: every call then throws
 * {@link SubjectKeysUnavailableError} (fail closed).
 */
export class SubjectKeyCipher {
  readonly #kek: Buffer | null;

  constructor(kek: Buffer | null) {
    if (kek !== null && kek.length !== KEY_BYTES) {
      throw new TypeError(`SubjectKeyCipher: the KEK must be ${KEY_BYTES} bytes`);
    }
    this.#kek = kek === null ? null : Buffer.from(kek);
  }

  get available(): boolean {
    return this.#kek !== null;
  }

  #key(): Buffer {
    if (this.#kek === null) throw new SubjectKeysUnavailableError();
    return this.#kek;
  }

  /**
   * The blind index of `value` for `purpose` in `tenant`: HMAC-SHA-256 under a key derived
   * from the KEK for that purpose only, so equal values can be found without storing them.
   * Deterministic: it reveals equality, never the value.
   */
  blindIndex(tenant: TenantContext, purpose: string, value: string): Buffer {
    const key = Buffer.from(
      hkdfSync('sha256', this.#key(), Buffer.alloc(0), `phoenix:blind-index:${purpose}:v1`, 32),
    );
    try {
      return createHmac('sha256', key).update(`${tenant.tenantId}\0${value}`, 'utf8').digest();
    } finally {
      key.fill(0);
    }
  }

  /** A new random data key for a subject and its wrapped form. */
  newKey(tenant: TenantContext, subjectId: Id<string>): { dataKey: Buffer; wrapped: Buffer } {
    const kek = this.#key();
    const dataKey = randomBytes(KEY_BYTES);
    return { dataKey, wrapped: seal(kek, associated('key', tenant, subjectId), dataKey) };
  }

  unwrap(tenant: TenantContext, subjectId: Id<string>, wrapped: Uint8Array): Buffer {
    const key = open(this.#key(), associated('key', tenant, subjectId), wrapped);
    if (key.length !== KEY_BYTES) throw new SealedValueError();
    return key;
  }

  encrypt(
    dataKey: Buffer,
    tenant: TenantContext,
    subjectId: Id<string>,
    plaintext: Uint8Array,
  ): Buffer {
    this.#key();
    return seal(dataKey, associated('data', tenant, subjectId), plaintext);
  }

  decrypt(
    dataKey: Buffer,
    tenant: TenantContext,
    subjectId: Id<string>,
    ciphertext: Uint8Array,
  ): Buffer {
    this.#key();
    return open(dataKey, associated('data', tenant, subjectId), ciphertext);
  }
}
