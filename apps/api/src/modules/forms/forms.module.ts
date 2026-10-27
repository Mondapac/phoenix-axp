import { Module, type Provider } from '@nestjs/common';
import type { Clock, IdGenerator } from '@phoenix/shared-kernel';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER, type AuditWriter } from '../../platform/audit/audit-writer';
import {
  ACTOR_GRANT_READER,
  FIELD_RULE_READER,
  registerPermissions,
  SITE_ANCESTRY_READER,
  USE_CASE_GATE,
  type ActorGrantReader,
  type FieldRuleReader,
  type SiteAncestryReader,
} from '../../platform/authz';
import { CAPTCHA_SERVICE } from '../../platform/captcha';
import { CLOCK } from '../../platform/clock/clock.module';
import { registerEvents } from '../../platform/events/event-catalogue';
import { OUTBOX_WRITER, type OutboxWriter } from '../../platform/events/outbox-writer';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { RATE_LIMITER, type RateLimiter } from '../../platform/rate-limit';
import { registerJobsFrom } from '../../platform/scheduler/job-registry';
import { SUBJECT_KEY_SERVICE, type SubjectKeyService } from '../../platform/subject-keys';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/unit-of-work/unit-of-work';
import { FORM_REACH, FormReach } from './application/form-reach';
import { FORM_REPOSITORY, type FormRepository } from './application/form.repository';
import {
  ANSWER_VALIDATOR,
  FORM_SCHEMA_CHECKER,
  type AnswerValidator,
} from './application/ports/form-schema-checker';
import { SUBMISSION_ACCESS, SubmissionAccess } from './application/submission-access';
import { SUBMISSION_INTAKE, SubmissionIntake } from './application/submission-intake';
import {
  SUBMISSION_REPOSITORY,
  type SubmissionRepository,
} from './application/submission.repository';
import { CreateForm } from './application/use-cases/create-form.use-case';
import { EraseExpiredSubmissions } from './application/use-cases/erase-expired-submissions.use-case';
import { EraseFormSubmission } from './application/use-cases/erase-form-submission.use-case';
import { IssueSubmissionChallenge } from './application/use-cases/issue-submission-challenge.use-case';
import { ListFormSubmissions } from './application/use-cases/list-form-submissions.use-case';
import { ListForms } from './application/use-cases/list-forms.use-case';
import { PublishForm } from './application/use-cases/publish-form.use-case';
import { RetireForm } from './application/use-cases/retire-form.use-case';
import { SaveFormRevision } from './application/use-cases/save-form-revision.use-case';
import { SubmitFormOnBehalf } from './application/use-cases/submit-form-on-behalf.use-case';
import { SubmitFormSignedIn } from './application/use-cases/submit-form-signed-in.use-case';
import { SubmitForm } from './application/use-cases/submit-form.use-case';
import { TrackSubmission } from './application/use-cases/track-submission.use-case';
import { UpdateFormSettings } from './application/use-cases/update-form-settings.use-case';
import { UpdateForm } from './application/use-cases/update-form.use-case';
import { ViewFormRevision } from './application/use-cases/view-form-revision.use-case';
import { ViewFormSubmission } from './application/use-cases/view-form-submission.use-case';
import { ViewForm } from './application/use-cases/view-form.use-case';
import { ViewPublishedFormSignedIn } from './application/use-cases/view-published-form-signed-in.use-case';
import { ViewPublishedForm } from './application/use-cases/view-published-form.use-case';
import { ResolvePublishedForms } from './application/use-cases/resolve-published-forms.use-case';
import { FORM_REFERENCES } from './contracts/form-references';
import { FormReferencesFacade } from './form-references.facade';
import { FORMS_PERMISSIONS } from './contracts/permissions';
import { FORMS_AUDIT_ACTIONS } from './domain/audit-actions';
import { FORMS_EVENTS } from './domain/events';
import { PrismaFormRepository } from './infrastructure/prisma-form.repository';
import { PrismaSubmissionRepository } from './infrastructure/prisma-submission.repository';
import { WorkerSchemaEngine } from './infrastructure/worker-schema-engine';
import { FormsController } from './presentation/forms.controller';
import { eraseExpiredSubmissionsJob } from './presentation/jobs/erase-expired-submissions.job';
import { PublicFormsController } from './presentation/public-forms.controller';

/** Each use case built with the gate first and its ports after, in constructor order. */
function useCase(
  type: abstract new (...args: never[]) => unknown,
  inject: unknown[],
  options: { readonly unit?: boolean } = {},
): Provider {
  return {
    provide: type,
    inject: [
      USE_CASE_GATE,
      ...(options.unit === false ? [] : [UNIT_OF_WORK]),
      ...inject,
    ] as never[],
    useFactory: (...deps: unknown[]) =>
      new (type as unknown as new (...args: unknown[]) => unknown)(...deps),
  };
}

const FORMS = FORM_REPOSITORY;
const SUBMISSIONS = SUBMISSION_REPOSITORY;
const REACH = FORM_REACH;

/**
 * The forms module (Phase 2 slices 2.4 and 2.5): form definitions, their immutable revisions
 * with stable field ids, the submission policy and retention, publishing and retiring behind
 * the studio API; and submissions: the public form, CAPTCHA, submitting (also on behalf of
 * someone), the tracking code, the form inbox under field-level access, and erasure. Schemas
 * are compiled and answers validated by Ajv in a worker thread. Site, grant and field-rule
 * questions go through platform/authz's ports, which tenancy and identity implement.
 */
@Module({
  controllers: [FormsController, PublicFormsController],
  providers: [
    registerPermissions('forms', FORMS_PERMISSIONS),
    registerAuditActions('forms', FORMS_AUDIT_ACTIONS),
    registerEvents('forms', FORMS_EVENTS),
    PersistenceModule.auditWriterFor('forms'),
    PersistenceModule.outboxWriterFor('forms'),
    { provide: FORMS, useClass: PrismaFormRepository },
    { provide: SUBMISSIONS, useClass: PrismaSubmissionRepository },
    WorkerSchemaEngine,
    { provide: FORM_SCHEMA_CHECKER, useExisting: WorkerSchemaEngine },
    { provide: ANSWER_VALIDATOR, useExisting: WorkerSchemaEngine },
    {
      provide: REACH,
      inject: [UNIT_OF_WORK, FORMS, ACTOR_GRANT_READER, SITE_ANCESTRY_READER],
      useFactory: (
        unitOfWork: UnitOfWork,
        forms: FormRepository,
        grants: ActorGrantReader,
        sites: SiteAncestryReader,
      ) => new FormReach(unitOfWork, forms, grants, sites),
    },
    {
      provide: SUBMISSION_ACCESS,
      inject: [FIELD_RULE_READER, SITE_ANCESTRY_READER],
      useFactory: (rules: FieldRuleReader, sites: SiteAncestryReader) =>
        new SubmissionAccess(rules, sites),
    },
    useCase(ListForms, [FORMS, REACH]),
    useCase(ViewForm, [FORMS, REACH]),
    useCase(ViewFormRevision, [FORMS, REACH]),
    useCase(CreateForm, [FORMS, REACH, SITE_ANCESTRY_READER, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(UpdateForm, [FORMS, REACH, AUDIT_WRITER, CLOCK]),
    useCase(UpdateFormSettings, [FORMS, REACH, AUDIT_WRITER, CLOCK]),
    useCase(SaveFormRevision, [
      FORMS,
      REACH,
      FORM_SCHEMA_CHECKER,
      AUDIT_WRITER,
      CLOCK,
      ID_GENERATOR,
    ]),
    useCase(PublishForm, [FORMS, REACH, FORM_SCHEMA_CHECKER, AUDIT_WRITER, CLOCK]),
    useCase(RetireForm, [FORMS, REACH, AUDIT_WRITER, CLOCK]),
    useCase(ResolvePublishedForms, [FORMS, REACH]),
    {
      provide: FORM_REFERENCES,
      inject: [ResolvePublishedForms],
      useFactory: (resolve: ResolvePublishedForms) => new FormReferencesFacade(resolve),
    },
    {
      provide: SUBMISSION_INTAKE,
      inject: [
        UNIT_OF_WORK,
        FORMS,
        SUBMISSIONS,
        ANSWER_VALIDATOR,
        RATE_LIMITER,
        SUBJECT_KEY_SERVICE,
        AUDIT_WRITER,
        OUTBOX_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        forms: FormRepository,
        submissions: SubmissionRepository,
        validator: AnswerValidator,
        limiter: RateLimiter,
        subjectKeys: SubjectKeyService,
        audit: AuditWriter,
        outbox: OutboxWriter,
        clock: Clock,
        ids: IdGenerator,
      ) =>
        new SubmissionIntake(
          unitOfWork,
          forms,
          submissions,
          validator,
          limiter,
          subjectKeys,
          audit,
          outbox,
          clock,
          ids,
        ),
    },
    useCase(ViewPublishedForm, [SUBMISSION_INTAKE, ACTOR_GRANT_READER], { unit: false }),
    useCase(ViewPublishedFormSignedIn, [SUBMISSION_INTAKE, ACTOR_GRANT_READER], { unit: false }),
    useCase(IssueSubmissionChallenge, [CAPTCHA_SERVICE, RATE_LIMITER], { unit: false }),
    useCase(SubmitForm, [SUBMISSION_INTAKE, CAPTCHA_SERVICE], { unit: false }),
    useCase(SubmitFormSignedIn, [SUBMISSION_INTAKE, ACTOR_GRANT_READER], { unit: false }),
    useCase(SubmitFormOnBehalf, [SUBMISSION_INTAKE, SUBMISSION_ACCESS], { unit: false }),
    useCase(TrackSubmission, [FORMS, SUBMISSIONS, RATE_LIMITER]),
    useCase(ListFormSubmissions, [FORMS, SUBMISSIONS, SUBMISSION_ACCESS, SUBJECT_KEY_SERVICE]),
    useCase(ViewFormSubmission, [FORMS, SUBMISSIONS, SUBMISSION_ACCESS, SUBJECT_KEY_SERVICE]),
    useCase(EraseFormSubmission, [
      SUBMISSIONS,
      FIELD_RULE_READER,
      SITE_ANCESTRY_READER,
      SUBJECT_KEY_SERVICE,
      AUDIT_WRITER,
      CLOCK,
    ]),
    useCase(EraseExpiredSubmissions, [SUBMISSIONS, SUBJECT_KEY_SERVICE, AUDIT_WRITER, CLOCK]),
    registerJobsFrom('forms', [EraseExpiredSubmissions], (erase: EraseExpiredSubmissions) => [
      eraseExpiredSubmissionsJob(erase),
    ]),
  ],
  exports: [FORM_REFERENCES],
})
export class FormsModule {}
