import { createHash, randomInt } from 'node:crypto';
import { err, ok } from '@phoenix/shared-kernel';
import type {
  CallContext,
  Clock,
  Id,
  IdGenerator,
  Result,
  Temporal,
  TenantContext,
} from '@phoenix/shared-kernel';
import type { ActorGrantReader } from '../../../platform/authz';
import type { AuditWriter } from '../../../platform/audit/audit-writer';
import type { OutboxWriter } from '../../../platform/events/outbox-writer';
import type { RateLimited, RateLimiter } from '../../../platform/rate-limit';
import type { SubjectKeyService } from '../../../platform/subject-keys';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import { FORM_SUBMITTED } from '../domain/audit-actions';
import { FORM_SUBMISSION_RECEIVED } from '../domain/events';
import type { FormField } from '../domain/form-fields';
import type { JsonObject } from '../domain/form-schema';
import {
  eraseAfterOf,
  formatTrackingCode,
  TRACKING_CODE_DIGITS,
  type SubmissionChannel,
  type Submitter,
} from '../domain/submission';
import { answersById, answersBytes } from './answers';
import { FORM_NOT_FOUND, type FormNotFound } from './failures';
import type { FormRecord, FormRepository, FormRevisionRecord } from './form.repository';
import type { AnswerValidator, InvalidAnswers } from './ports/form-schema-checker';
import { limitSubject, SUBMIT_LIMIT } from './rate-limits';
import type { SubmissionRepository } from './submission.repository';

export interface SubmittedForm {
  readonly submissionId: Id<'FormSubmission'>;
  /** Shown once: only its hash is stored. */
  readonly trackingCode: string;
  readonly submittedAt: Temporal.Instant;
}

/** A published form as it is served: its revision, saved with field ids. */
export interface ServedForm {
  readonly form: FormRecord;
  readonly revision: FormRevisionRecord;
  readonly fields: readonly FormField[];
}

export type SubmissionUnavailable = { readonly code: 'forms.submission.unavailable' };

/** The tracking code: 16 digits from the CSPRNG. */
function newTrackingCode(): string {
  let digits = '';
  while (digits.length < TRACKING_CODE_DIGITS) digits += String(randomInt(0, 10));
  return digits;
}

export const trackingCodeHash = (digits: string): string =>
  createHash('sha256').update(digits, 'utf8').digest('hex');

/**
 * Who a signed-in or anonymous caller is under a form's policy. A staff member's listed role
 * comes from their grants (read in a unit of the reader's own: call it outside a unit).
 */
export async function submitterOf(
  context: CallContext,
  form: FormRecord,
  grants: ActorGrantReader,
): Promise<Submitter> {
  const { actor } = context;
  if (actor.kind === 'anonymous') return { kind: 'anonymous' };
  if (actor.kind !== 'authenticated') return { kind: 'other' };
  if (actor.population === 'portal-user') return { kind: 'portal-user' };
  if (actor.population !== 'tenant-staff') return { kind: 'other' };
  const listed = new Set<string>(form.policy.roleIds);
  const holdsListedRole =
    form.policy.audience === 'staff-roles' &&
    (await grants.grantsOf(context)).some((grant) => listed.has(grant.roleId));
  return { kind: 'staff', holdsListedRole };
}

/** Ends the unit when the drawn tracking code is taken, so it is drawn again. */
class TrackingCodeTaken extends Error {
  override readonly name = 'TrackingCodeTaken';
}

/**
 * The steps every way of submitting shares (phase 2 review, slice 2.5): the rate limit, the
 * published form and its revision, and taking the answers: validated against the revision's
 * schema, sealed under a new subject key of the submission (ADR-0003), then the submission,
 * its key and the audit row in one unit. The submission keeps the revision id and hash
 * (ADR-0007 V3). Who may submit is each use case's own decision, made before `take`.
 */
export class SubmissionIntake {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly submissions: SubmissionRepository,
    private readonly validator: AnswerValidator,
    private readonly limiter: RateLimiter,
    private readonly subjectKeys: SubjectKeyService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** The submit rate limit of the caller (the account, else the client's address). */
  async limit(
    context: CallContext,
    clientAddress: string,
  ): Promise<Result<void, RateLimited | SubmissionUnavailable>> {
    const limited = await this.limiter.consume(
      context.tenant,
      SUBMIT_LIMIT,
      limitSubject(context.actor, clientAddress),
    );
    if (!limited.ok) return limited;
    if (!this.subjectKeys.available) return err({ code: 'forms.submission.unavailable' } as const);
    return ok(undefined);
  }

  /** The published form of `key`; null when it serves nothing (a revision without field ids). */
  async served(tenant: TenantContext, key: string): Promise<ServedForm | null> {
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const form = await this.forms.findByKey(tenant, key);
        if (form === null || form.status !== 'published' || form.publishedRevisionId === null) {
          return ok(null);
        }
        const revision = await this.forms.findRevision(tenant, form.publishedRevisionId);
        return ok(revision === null ? null : { form, revision });
      },
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return null;
    const { form, revision } = read.value;
    // A revision saved before field ids existed is never served (publish refuses it too).
    if (revision.fields === null) return null;
    return { form, revision, fields: revision.fields };
  }

  /** Validates, seals and stores `answers` (already read against the revision's fields). */
  async take(
    context: CallContext,
    served: ServedForm,
    channel: SubmissionChannel,
    answers: JsonObject,
  ): Promise<Result<SubmittedForm, FormNotFound | InvalidAnswers>> {
    const { tenant, actor } = context;
    const { form, revision, fields } = served;
    const valid = await this.validator.validate(revision, answers);
    if (!valid.ok) return valid;

    // CPU work before the unit: the subject key, the encryption, the tracking code's hash.
    const id = this.ids.next<'FormSubmission'>();
    const sealed = this.subjectKeys.seal(tenant, id, answersBytes(answersById(answers, fields)));
    const submittedAt = this.clock.now();
    const submittedBy = actor.kind === 'authenticated' ? actor.accountId : null;
    const eraseAfter = eraseAfterOf(form.retention, submittedAt);

    // A tracking code that is already in use (1 in 10^16) is drawn again, once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const code = newTrackingCode();
      const saved = await this.unitOfWork
        .run<SubmittedForm | null, FormNotFound>(tenant, async () => {
          // The form may have been retired since it was read: then it takes nothing more.
          const current = await this.forms.find(tenant, form.id);
          if (current === null || current.status !== 'published') return err(FORM_NOT_FOUND);
          await this.subjectKeys.store(tenant, id, 'forms', sealed.wrappedKey, submittedAt);
          const inserted = await this.submissions.insert(tenant, {
            id,
            formId: form.id,
            revisionId: revision.id,
            revisionHash: revision.contentHash,
            siteId: form.siteId,
            channel,
            submittedBy,
            data: sealed.ciphertext,
            submittedAt,
            eraseAfter,
            trackingCodeHash: trackingCodeHash(code),
          });
          if (inserted === 'tracking-code-taken') throw new TrackingCodeTaken();
          await this.audit.record(
            context,
            FORM_SUBMITTED.entry(id, {
              after: { formId: form.id, revisionId: revision.id, channel, boundSubjectId: id },
            }),
          );
          // The process the form starts, if any, starts from this event (slice 2.6).
          await this.outbox.append(context, [
            FORM_SUBMISSION_RECEIVED.record({
              aggregateId: id,
              aggregateVersion: 1,
              occurredAt: submittedAt,
              payload: { formId: form.id, revisionId: revision.id, siteId: form.siteId, channel },
            }),
          ]);
          return ok({ submissionId: id, trackingCode: formatTrackingCode(code), submittedAt });
        })
        .catch((error: unknown) => {
          if (error instanceof TrackingCodeTaken) return ok(null);
          throw error;
        });
      if (!saved.ok) return saved;
      if (saved.value !== null) return ok(saved.value);
    }
    throw new Error('forms.submission-intake: no free tracking code after two draws');
  }
}

export const SUBMISSION_INTAKE = Symbol('SUBMISSION_INTAKE');
