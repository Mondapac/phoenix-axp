import type { ContentHash, Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { ObjectField } from '../domain/fields';
import type { DefinitionStatus } from '../domain/lifecycle';

/** A definition as the use cases read it, without its revisions. */
export interface DefinitionRecord {
  readonly id: Id<'ObjectDefinition'>;
  readonly siteId: Id<'Site'>;
  readonly key: string;
  readonly name: string;
  readonly status: DefinitionStatus;
  readonly publishedRevisionId: Id<'ObjectRevision'> | null;
  /** The number of the newest revision; 0 before the first is saved. */
  readonly latestRevisionNumber: number;
  readonly version: number;
}

export interface RevisionSummary {
  readonly id: Id<'ObjectRevision'>;
  readonly definitionId: Id<'ObjectDefinition'>;
  readonly number: number;
  readonly contentHash: ContentHash;
  readonly createdAt: Temporal.Instant;
}

export interface RevisionRecord extends RevisionSummary {
  readonly fields: readonly ObjectField[];
}

export interface DefinitionFilter {
  readonly siteId: Id<'Site'> | null;
  readonly status: DefinitionStatus | null;
}

/** The changes of {@link DefinitionRepository.saveState}: what the definition's version covers. */
export interface DefinitionChanges {
  readonly name?: string;
  readonly status?: DefinitionStatus;
  readonly publishedRevisionId?: Id<'ObjectRevision'> | null;
}

/**
 * The Object definitions of one tenant and their revisions (ADR-0007 pattern V1): a revision
 * is inserted once and never changed. Every method runs in the caller's open unit.
 */
export interface DefinitionRepository {
  find(tenant: TenantContext, id: Id<'ObjectDefinition'>): Promise<DefinitionRecord | null>;
  findByKey(tenant: TenantContext, key: string): Promise<DefinitionRecord | null>;
  /** By name then id. */
  list(tenant: TenantContext, filter: DefinitionFilter): Promise<DefinitionRecord[]>;
  insert(
    tenant: TenantContext,
    definition: Pick<DefinitionRecord, 'id' | 'siteId' | 'key' | 'name'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'key-taken'>;
  /** Throws StaleAggregateError on another version. */
  saveState(
    tenant: TenantContext,
    id: Id<'ObjectDefinition'>,
    expectedVersion: number,
    changes: DefinitionChanges,
    at: Temporal.Instant,
  ): Promise<void>;
  /**
   * Takes the next revision number under a row lock held until the unit ends; null when the
   * definition does not exist. Does not change the definition's version.
   */
  takeRevisionNumber(tenant: TenantContext, id: Id<'ObjectDefinition'>): Promise<number | null>;
  /** The revision `number` of the definition, or null. */
  revisionByNumber(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
    number: number,
  ): Promise<RevisionRecord | null>;
  insertRevision(tenant: TenantContext, revision: RevisionRecord): Promise<void>;
  findRevision(tenant: TenantContext, id: Id<'ObjectRevision'>): Promise<RevisionRecord | null>;
  /** The revisions asked, by id; an unknown id is absent. */
  revisions(
    tenant: TenantContext,
    ids: readonly Id<'ObjectRevision'>[],
  ): Promise<ReadonlyMap<string, RevisionRecord>>;
  /** Newest first. */
  listRevisions(
    tenant: TenantContext,
    definitionId: Id<'ObjectDefinition'>,
  ): Promise<RevisionSummary[]>;
}

export const DEFINITION_REPOSITORY = Symbol('DEFINITION_REPOSITORY');
