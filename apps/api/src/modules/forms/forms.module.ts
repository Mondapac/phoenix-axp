import { Module, type Provider } from '@nestjs/common';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER } from '../../platform/audit/audit-writer';
import { registerPermissions, SITE_ANCESTRY_READER, USE_CASE_GATE } from '../../platform/authz';
import { CLOCK } from '../../platform/clock/clock.module';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { UNIT_OF_WORK } from '../../platform/unit-of-work/unit-of-work';
import { FORM_REPOSITORY } from './application/form.repository';
import { FORM_SCHEMA_CHECKER } from './application/ports/form-schema-checker';
import { CreateForm } from './application/use-cases/create-form.use-case';
import { ListForms } from './application/use-cases/list-forms.use-case';
import { PublishForm } from './application/use-cases/publish-form.use-case';
import { RetireForm } from './application/use-cases/retire-form.use-case';
import { SaveFormRevision } from './application/use-cases/save-form-revision.use-case';
import { UpdateForm } from './application/use-cases/update-form.use-case';
import { ViewFormRevision } from './application/use-cases/view-form-revision.use-case';
import { ViewForm } from './application/use-cases/view-form.use-case';
import { FORMS_PERMISSIONS } from './contracts/permissions';
import { FORMS_AUDIT_ACTIONS } from './domain/audit-actions';
import { AjvFormSchemaChecker } from './infrastructure/ajv-form-schema-checker';
import { PrismaFormRepository } from './infrastructure/prisma-form.repository';
import { FormsController } from './presentation/forms.controller';

/** Each use case built with the gate first and its ports after, in constructor order. */
function useCase(type: abstract new (...args: never[]) => unknown, inject: unknown[]): Provider {
  return {
    provide: type,
    inject: [USE_CASE_GATE, UNIT_OF_WORK, ...inject] as never[],
    useFactory: (...deps: unknown[]) =>
      new (type as unknown as new (...args: unknown[]) => unknown)(...deps),
  };
}

const FORMS = FORM_REPOSITORY;

/**
 * The forms module (Phase 2 slice 2.4): form definitions, their immutable revisions with
 * JSON Schema checked by Ajv, the submission policy and retention, publishing and retiring,
 * behind the studio API. The site check goes through platform/authz's site-ancestry port,
 * which tenancy implements. Its audit writer stays inside the module.
 */
@Module({
  controllers: [FormsController],
  providers: [
    registerPermissions('forms', FORMS_PERMISSIONS),
    registerAuditActions('forms', FORMS_AUDIT_ACTIONS),
    PersistenceModule.auditWriterFor('forms'),
    { provide: FORMS, useClass: PrismaFormRepository },
    { provide: FORM_SCHEMA_CHECKER, useClass: AjvFormSchemaChecker },
    useCase(ListForms, [FORMS]),
    useCase(ViewForm, [FORMS]),
    useCase(ViewFormRevision, [FORMS]),
    useCase(CreateForm, [FORMS, SITE_ANCESTRY_READER, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(UpdateForm, [FORMS, AUDIT_WRITER, CLOCK]),
    useCase(SaveFormRevision, [FORMS, FORM_SCHEMA_CHECKER, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(PublishForm, [FORMS, AUDIT_WRITER, CLOCK]),
    useCase(RetireForm, [FORMS, AUDIT_WRITER, CLOCK]),
  ],
})
export class FormsModule {}
