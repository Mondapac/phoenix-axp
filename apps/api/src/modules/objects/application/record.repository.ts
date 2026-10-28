import type { ContentHash, Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { RecordValues } from '../domain/record-values';

/** A record as stored: plain values, and the sealed ones still sealed. */
export interface StoredRecord {
  readonly id: Id<'ObjectRecord'>;
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly revisionId: Id<'ObjectRevision'>;
  readonly revisionHash: ContentHash;
  readonly siteId: Id<'Site'>;
  readonly createdBy: Id<'Account'>;
  /** The non-sensitive values. */
  readonly values: RecordValues;
  /** The sensitive values, sealed under the record's subject key. */
  readonly sealed: Buffer;
  readonly version: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
}

/** Which sites a list may show: every site, or only these. */
export type SiteFilter = 'all' | readonly Id<'Site'>[];

export interface RecordPage {
  readonly sites: SiteFilter;
  /** Records older than this id (ids are UUIDv7), for the next page. */
  readonly before: Id<'ObjectRecord'> | null;
  readonly limit: number;
}

export interface RecordWrite {
  readonly revisionId: Id<'ObjectRevision'>;
  readonly revisionHash: ContentHash;
  readonly values: RecordValues;
  readonly sealed: Buffer;
}

/** The records of one tenant's definitions. Every method runs in the caller's open unit. */
export interface RecordRepository {
  find(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    id: Id<'ObjectRecord'>,
  ): Promise<StoredRecord | null>;
  /** Newest first, in the sites of `page.sites`. */
  list(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    page: RecordPage,
  ): Promise<StoredRecord[]>;
  insert(
    tenant: TenantContext,
    record: Omit<StoredRecord, 'version' | 'createdAt' | 'updatedAt'>,
    at: Temporal.Instant,
  ): Promise<void>;
  /** Throws StaleAggregateError on another version or a removed record. */
  update(
    tenant: TenantContext,
    id: Id<'ObjectRecord'>,
    expectedVersion: number,
    write: RecordWrite,
    at: Temporal.Instant,
  ): Promise<void>;
  /** Throws StaleAggregateError on another version or a removed record. */
  delete(tenant: TenantContext, id: Id<'ObjectRecord'>, expectedVersion: number): Promise<void>;
}

export const RECORD_REPOSITORY = Symbol('RECORD_REPOSITORY');
