import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';

/**
 * The wrapped data keys in `platform.subject_key` (implemented in platform/persistence/). Every
 * method runs in the caller's open unit (`tx(tenant)`).
 */
export interface SubjectKeyStore {
  insert(
    tenant: TenantContext,
    key: {
      readonly subjectId: Id<string>;
      readonly module: string;
      readonly wrappedKey: Uint8Array;
    },
    at: Temporal.Instant,
  ): Promise<void>;
  /**
   * The wrapped keys of the subjects asked: `null` for a destroyed key; a subject without a
   * row is absent from the map.
   */
  wrappedKeys(
    tenant: TenantContext,
    subjectIds: readonly Id<string>[],
  ): Promise<ReadonlyMap<string, Uint8Array | null>>;
  /** Destroys a live key for good; false when there was no live key. */
  destroy(tenant: TenantContext, subjectId: Id<string>, at: Temporal.Instant): Promise<boolean>;
}

export const SUBJECT_KEY_STORE = Symbol('SUBJECT_KEY_STORE');
