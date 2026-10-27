import type { ContentHash, Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { FormField } from '../domain/form-fields';
import type { Retention, SubmissionPolicy } from '../domain/form-settings';
import type { JsonObject } from '../domain/form-schema';
import type { FormStatus } from '../domain/lifecycle';

/** A form as the use cases read it, without its revisions' documents. */
export interface FormRecord {
  readonly id: Id<'Form'>;
  /** The site whose form inbox receives the submissions. */
  readonly siteId: Id<'Site'>;
  readonly key: string;
  readonly name: string;
  readonly status: FormStatus;
  readonly publishedRevisionId: Id<'FormRevision'> | null;
  readonly policy: SubmissionPolicy;
  readonly retention: Retention;
  /** The number of the newest revision; 0 before the first is saved. */
  readonly latestRevisionNumber: number;
  readonly version: number;
}

/** A revision without its documents, for lists. */
export interface FormRevisionSummary {
  readonly id: Id<'FormRevision'>;
  readonly formId: Id<'Form'>;
  readonly number: number;
  readonly contentHash: ContentHash;
  readonly createdAt: Temporal.Instant;
}

export interface FormRevisionRecord extends FormRevisionSummary {
  readonly jsonSchema: JsonObject;
  readonly uiSchema: JsonObject;
  /** Null for a revision saved before field ids existed (slice 2.4). */
  readonly fields: readonly FormField[] | null;
}

/** A revision's fields only, for reading answers stored under it. */
export interface RevisionFields {
  readonly id: Id<'FormRevision'>;
  readonly number: number;
  readonly fields: readonly FormField[] | null;
}

export interface FormFilter {
  readonly siteId: Id<'Site'> | null;
  readonly status: FormStatus | null;
}

/** The changes of {@link FormRepository.saveState}: what the form's own version covers. */
export interface FormChanges {
  readonly name?: string;
  readonly policy?: SubmissionPolicy;
  readonly retention?: Retention;
  readonly status?: FormStatus;
  readonly publishedRevisionId?: Id<'FormRevision'> | null;
}

/**
 * The forms of one tenant and their revisions (ADR-0007 pattern V1): a revision is inserted
 * once and never changed; the form points at the revision it publishes. Every method runs in
 * the caller's open unit (`tx(tenant)`).
 */
export interface FormRepository {
  find(tenant: TenantContext, id: Id<'Form'>): Promise<FormRecord | null>;
  findByKey(tenant: TenantContext, key: string): Promise<FormRecord | null>;
  /** The forms of these keys that exist, in no particular order. */
  findByKeys(tenant: TenantContext, keys: readonly string[]): Promise<FormRecord[]>;
  /** The tenant's forms, by name then id. */
  list(tenant: TenantContext, filter: FormFilter): Promise<FormRecord[]>;
  /** `key-taken` when the key is in use in the tenant. */
  insert(
    tenant: TenantContext,
    form: Omit<FormRecord, 'status' | 'publishedRevisionId' | 'latestRevisionNumber' | 'version'>,
    at: Temporal.Instant,
  ): Promise<'created' | 'key-taken'>;
  /** Saves the changes and the next version; throws StaleAggregateError on another version. */
  saveState(
    tenant: TenantContext,
    id: Id<'Form'>,
    expectedVersion: number,
    changes: FormChanges,
    at: Temporal.Instant,
  ): Promise<void>;
  /**
   * Takes the form's next revision number: a row lock on the form until the unit ends, so
   * numbers never repeat or skip and concurrent saves of one form run one after the other.
   * Null when the form does not exist. Does not change the form's version.
   */
  takeRevisionNumber(tenant: TenantContext, formId: Id<'Form'>): Promise<number | null>;
  /** The fields of the form's revision `number`; null when it has none or does not exist. */
  revisionFields(
    tenant: TenantContext,
    formId: Id<'Form'>,
    number: number,
  ): Promise<readonly FormField[] | null>;
  /** Inserts a revision under a number taken by {@link takeRevisionNumber} in this unit. */
  insertRevision(
    tenant: TenantContext,
    revision: FormRevisionRecord & { readonly fields: readonly FormField[] },
  ): Promise<void>;
  findRevision(tenant: TenantContext, id: Id<'FormRevision'>): Promise<FormRevisionRecord | null>;
  /** The fields of the revisions asked, by id; an unknown id is absent. */
  fieldsOfRevisions(
    tenant: TenantContext,
    ids: readonly Id<'FormRevision'>[],
  ): Promise<ReadonlyMap<string, RevisionFields>>;
  /** Newest first. */
  listRevisions(tenant: TenantContext, formId: Id<'Form'>): Promise<FormRevisionSummary[]>;
}

export const FORM_REPOSITORY = Symbol('FORM_REPOSITORY');
