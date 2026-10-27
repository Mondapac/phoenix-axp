import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Result, Temporal } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { RateLimited, RateLimiter } from '../../../../platform/rate-limit';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { parseTrackingCode, type SubmissionStatus } from '../../domain/submission';
import type { FormRepository } from '../form.repository';
import { limitSubject, TRACK_LIMIT } from '../rate-limits';
import type { SubmissionRepository } from '../submission.repository';
import { SUBMISSION_NOT_FOUND, type SubmissionNotFound } from './view-form-submission.use-case';
import { trackingCodeHash } from '../submission-intake';

export interface TrackSubmissionInput {
  /** As the person typed it: Persian digits, spaces and hyphens are accepted. */
  readonly trackingCode: string;
  readonly clientAddress: string;
}

/** The tracking page (phase 2 review 2.5): status and dates, never an answer or a person. */
export interface TrackedView {
  readonly form: { readonly name: string };
  readonly status: SubmissionStatus;
  readonly submittedAt: Temporal.Instant;
}

/**
 * Looks a submission up by its tracking code, without signing in. Answers only the form's name,
 * the status and when it was submitted; an unknown or malformed code answers not found. Rate
 * limited per client, so codes cannot be tried in bulk.
 */
export class TrackSubmission extends UseCase<
  TrackSubmissionInput,
  TrackedView,
  SubmissionNotFound | RateLimited
> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.track-submission',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly forms: FormRepository,
    private readonly submissions: SubmissionRepository,
    private readonly limiter: RateLimiter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: TrackSubmissionInput,
  ): Promise<Result<TrackedView, SubmissionNotFound | RateLimited>> {
    const { tenant, actor } = context;
    const limited = await this.limiter.consume(
      tenant,
      TRACK_LIMIT,
      limitSubject(actor, input.clientAddress),
    );
    if (!limited.ok) return limited;
    const digits = parseTrackingCode(input.trackingCode);
    if (digits === null) return err(SUBMISSION_NOT_FOUND);
    return this.unitOfWork.run<TrackedView, SubmissionNotFound>(
      tenant,
      async () => {
        const tracked = await this.submissions.findByTrackingCode(tenant, trackingCodeHash(digits));
        if (tracked === null) return err(SUBMISSION_NOT_FOUND);
        const form = await this.forms.find(tenant, tracked.formId);
        if (form === null) return err(SUBMISSION_NOT_FOUND);
        return ok({
          form: { name: form.name },
          status: tracked.status,
          submittedAt: tracked.submittedAt,
        });
      },
      { readOnly: true },
    );
  }
}
