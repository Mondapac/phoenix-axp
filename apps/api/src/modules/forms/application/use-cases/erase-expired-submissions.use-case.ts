import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { FORM_SUBMISSION_ERASED } from '../../domain/audit-actions';
import type { SubmissionRepository } from '../submission.repository';

/** The submissions one unit erases; a run takes batches until none is due. */
export const ERASE_BATCH = 100;
/** The most batches one run takes, so a run stays inside the job's time budget. */
export const MAX_ERASE_BATCHES = 50;

/**
 * The retention job's use case (owner decision D5): erases the personal data of every
 * submission whose form's retention, fixed when it was submitted, has ended. Each batch is one
 * unit; safe to run twice and concurrently (a submission another run erased first is skipped:
 * the conditional update changes nothing, and its key and audit row are left to that run).
 */
export class EraseExpiredSubmissions extends UseCase<void, { readonly erased: number }, never> {
  static override readonly access: AccessDeclaration = {
    name: 'forms.erase-expired-submissions',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly submissions: SubmissionRepository,
    private readonly subjectKeys: SubjectKeyService,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
  ): Promise<Result<{ readonly erased: number }, never>> {
    const { tenant } = context;
    let erased = 0;
    for (let batch = 0; batch < MAX_ERASE_BATCHES; batch += 1) {
      const done = await this.unitOfWork.run<{ due: number; count: number }, never>(
        tenant,
        async () => {
          const now = this.clock.now();
          const due = await this.submissions.dueForErasure(tenant, now, ERASE_BATCH);
          let count = 0;
          for (const submission of due) {
            if (
              !(await this.submissions.markErased(tenant, submission.id, submission.version, now))
            ) {
              continue;
            }
            count += 1;
            await this.subjectKeys.destroy(tenant, submission.id, now);
            await this.audit.record(
              context,
              FORM_SUBMISSION_ERASED.entry(submission.id, {
                after: { formId: submission.formId, reason: 'retention' },
              }),
            );
          }
          return ok({ due: due.length, count });
        },
      );
      if (!done.ok) break;
      erased += done.value.count;
      if (done.value.due < ERASE_BATCH) break;
    }
    return ok({ erased });
  }
}
