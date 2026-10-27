import type { ContentHash, Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { SubmissionChannel, SubmissionStatus } from '../domain/submission';

/** A submission as the use cases read it; `data` is the sealed answers. */
export interface SubmissionRecord {
  readonly id: Id<'FormSubmission'>;
  readonly formId: Id<'Form'>;
  readonly revisionId: Id<'FormRevision'>;
  readonly revisionHash: ContentHash;
  readonly siteId: Id<'Site'>;
  readonly channel: SubmissionChannel;
  readonly submittedBy: Id<'Account'> | null;
  readonly status: SubmissionStatus;
  readonly data: Uint8Array;
  readonly submittedAt: Temporal.Instant;
  readonly eraseAfter: Temporal.Instant | null;
  readonly erasedAt: Temporal.Instant | null;
  readonly version: number;
}

/** What the tracking page may know: no answer, no submitter. */
export interface TrackedSubmission {
  readonly formId: Id<'Form'>;
  readonly status: SubmissionStatus;
  readonly submittedAt: Temporal.Instant;
}

/** The position after which a page of a form inbox starts (newest first). */
export interface InboxCursor {
  readonly submittedAt: Temporal.Instant;
  readonly id: Id<'FormSubmission'>;
}

/** A submission due for erasure under its form's retention. */
export interface DueSubmission {
  readonly id: Id<'FormSubmission'>;
  readonly formId: Id<'Form'>;
  readonly version: number;
}

/**
 * The submissions of one tenant (ADR-0007 V3): inserted once; only the status, the erasure
 * mark and the version change. Every method runs in the caller's open unit (`tx(tenant)`).
 */
export interface SubmissionRepository {
  /** `tracking-code-taken` when the code's hash is in use in the tenant (a 1 in 10^16 draw). */
  insert(
    tenant: TenantContext,
    submission: Omit<SubmissionRecord, 'status' | 'erasedAt' | 'version'> & {
      readonly trackingCodeHash: string;
    },
  ): Promise<'created' | 'tracking-code-taken'>;
  find(tenant: TenantContext, id: Id<'FormSubmission'>): Promise<SubmissionRecord | null>;
  findByTrackingCode(tenant: TenantContext, codeHash: string): Promise<TrackedSubmission | null>;
  /** One form's submissions, newest first, after `cursor`. */
  listForForm(
    tenant: TenantContext,
    formId: Id<'Form'>,
    page: { readonly after: InboxCursor | null; readonly limit: number },
  ): Promise<SubmissionRecord[]>;
  /**
   * Sets the erasure mark and the next version. False, changing nothing, when the submission
   * has another version or was erased since it was read (a concurrent erasure waits for the
   * first one's row lock, then finds nothing to change).
   */
  markErased(
    tenant: TenantContext,
    id: Id<'FormSubmission'>,
    expectedVersion: number,
    at: Temporal.Instant,
  ): Promise<boolean>;
  /** Submissions not yet erased whose retention ended at or before `now`, oldest first. */
  dueForErasure(
    tenant: TenantContext,
    now: Temporal.Instant,
    limit: number,
  ): Promise<DueSubmission[]>;
}

export const SUBMISSION_REPOSITORY = Symbol('SUBMISSION_REPOSITORY');
