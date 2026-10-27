import type { ObjectKey } from './object-key';

/** Injection token for the {@link ObjectStore}. */
export const OBJECT_STORE = Symbol('OBJECT_STORE');

/** The longest a signed download URL lives: a link is issued per request, never stored. */
export const MAX_SIGNED_URL_SECONDS = 900;

export interface SignedDownloadOptions {
  /** 1 to {@link MAX_SIGNED_URL_SECONDS}. */
  readonly expiresInSeconds: number;
  /** The name the browser saves the file under; already sanitised by the file intake. */
  readonly fileName?: string;
}

/**
 * The object storage port (ADR-0012 decision 1). Only a use case that checked permission and
 * ownership calls it; the key carries the tenant. Content is written once: a changed file is a
 * new object with a new id.
 *
 * Infrastructure failures throw; a missing object is a value, since it is expected after a
 * delete or for an id that never had a file.
 */
export interface ObjectStore {
  /** Stores `body` under `key`. Keys hold fresh ids, so a put never replaces another file. */
  put(key: ObjectKey, body: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes, or `null` when there is none. */
  get(key: ObjectKey): Promise<Uint8Array | null>;
  /** Removes the object; removing a missing object succeeds. */
  delete(key: ObjectKey): Promise<void>;
  /** A short-lived URL that downloads the object as an attachment. */
  signedDownloadUrl(key: ObjectKey, options: SignedDownloadOptions): Promise<string>;
}

/** Thrown by every call when this deployment has no object store configured (`S3_*` unset). */
export class StorageUnavailableError extends Error {
  constructor() {
    super('Object storage is not configured for this deployment (S3_* variables)');
    this.name = 'StorageUnavailableError';
  }
}

/**
 * Bound when the storage variables are unset (development and test only; production refuses
 * to start without them). Fails closed: it stores nothing and serves nothing.
 */
export class UnconfiguredObjectStore implements ObjectStore {
  put(): Promise<void> {
    return Promise.reject(new StorageUnavailableError());
  }

  get(): Promise<Uint8Array | null> {
    return Promise.reject(new StorageUnavailableError());
  }

  delete(): Promise<void> {
    return Promise.reject(new StorageUnavailableError());
  }

  signedDownloadUrl(): Promise<string> {
    return Promise.reject(new StorageUnavailableError());
  }
}
