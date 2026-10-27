import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId, Temporal } from '@phoenix/shared-kernel';
import type { CallContext } from '@phoenix/shared-kernel';
import type { InboxCursor } from '../application/submission.repository';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { CreateForm } from '../application/use-cases/create-form.use-case';
import { EraseFormSubmission } from '../application/use-cases/erase-form-submission.use-case';
import { ListFormSubmissions } from '../application/use-cases/list-form-submissions.use-case';
import { ViewFormSubmission } from '../application/use-cases/view-form-submission.use-case';
import { ListForms } from '../application/use-cases/list-forms.use-case';
import { PublishForm } from '../application/use-cases/publish-form.use-case';
import { RetireForm } from '../application/use-cases/retire-form.use-case';
import { SaveFormRevision } from '../application/use-cases/save-form-revision.use-case';
import { UpdateFormSettings } from '../application/use-cases/update-form-settings.use-case';
import { UpdateForm } from '../application/use-cases/update-form.use-case';
import { ViewFormRevision } from '../application/use-cases/view-form-revision.use-case';
import { ViewForm } from '../application/use-cases/view-form.use-case';
import { PORTAL_MODES } from '../domain/form-fields';
import { FORM_STATUSES } from '../domain/lifecycle';
import { answer, idField, idParam, parseRequest } from './http';

const FORM_NOT_FOUND = 'forms.form.not-found';

const listQuery = z.strictObject({
  site: idField<'Site'>().optional(),
  status: z.enum(FORM_STATUSES).optional(),
});
const settings = {
  policy: z.strictObject({
    audience: z.string().max(32),
    roleIds: z.array(idField<'Role'>()).max(64).default([]),
    allowOnBehalf: z.boolean(),
  }),
  retention: z
    .strictObject({ kind: z.string().max(16), days: z.number().int().optional() })
    .optional(),
};
const createBody = z.strictObject({
  siteId: idField<'Site'>(),
  key: z.string().max(256),
  name: z.string().max(1024),
  ...settings,
});
const updateBody = z.strictObject({
  version: z.number().int().min(1),
  name: z.string().max(1024),
  ...settings,
});
const settingsBody = z.strictObject({ version: z.number().int().min(1), ...settings });
// The documents are checked by the use case, which answers with the problem and its place.
const fieldSetting = z.strictObject({
  id: idField<'Field'>().optional(),
  sensitive: z.boolean().optional(),
  portal: z.enum(PORTAL_MODES).optional(),
});
const revisionBody = z.strictObject({
  jsonSchema: z.unknown(),
  uiSchema: z.unknown(),
  fields: z.record(z.string().max(256), fieldSetting).optional(),
});
const inboxQuery = z.strictObject({
  after: z
    .string()
    .regex(/^\d{1,16}\.[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const eraseBody = z.strictObject({ version: z.number().int().min(1) });
const publishBody = z.strictObject({
  version: z.number().int().min(1),
  revisionId: idField<'FormRevision'>(),
});
const retireBody = z.strictObject({ version: z.number().int().min(1) });

/** The form definitions of the caller's tenant (studio API; ADR-0007). */
@ApiTags('forms')
@Controller('forms')
export class FormsController {
  constructor(
    private readonly listForms: ListForms,
    private readonly viewForm: ViewForm,
    private readonly createForm: CreateForm,
    private readonly updateForm: UpdateForm,
    private readonly updateFormSettings: UpdateFormSettings,
    private readonly saveFormRevision: SaveFormRevision,
    private readonly viewFormRevision: ViewFormRevision,
    private readonly publishForm: PublishForm,
    private readonly retireForm: RetireForm,
    private readonly listFormSubmissions: ListFormSubmissions,
    private readonly viewFormSubmission: ViewFormSubmission,
    private readonly eraseFormSubmission: EraseFormSubmission,
  ) {}

  @Get('forms')
  async list(@Call() context: CallContext, @Query() query: unknown) {
    const { site, status } = parseRequest(listQuery, query);
    return {
      items: answer(
        await this.listForms.execute(context, { siteId: site ?? null, status: status ?? null }),
      ),
    };
  }

  @Post('forms')
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.createForm.execute(context, parseRequest(createBody, body)));
  }

  @Get('forms/:formId')
  async view(@Call() context: CallContext, @Param('formId') formId: string) {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    return answer(await this.viewForm.execute(context, { formId: id }));
  }

  @Patch('forms/:formId')
  @HttpCode(204)
  async update(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    answer(
      await this.updateForm.execute(context, { formId: id, ...parseRequest(updateBody, body) }),
    );
  }

  /** The policy and retention of a form in any status: a publisher's change. */
  @Put('forms/:formId/settings')
  @HttpCode(204)
  async updateSettings(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    answer(
      await this.updateFormSettings.execute(context, {
        formId: id,
        ...parseRequest(settingsBody, body),
      }),
    );
  }

  @Post('forms/:formId/revisions')
  async saveRevision(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Body() body: unknown,
  ) {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    return answer(
      await this.saveFormRevision.execute(context, {
        formId: id,
        ...parseRequest(revisionBody, body),
      }),
    );
  }

  @Get('revisions/:revisionId')
  async viewRevision(@Call() context: CallContext, @Param('revisionId') revisionId: string) {
    const id = idParam<'FormRevision'>(revisionId, 'forms.form-revision.not-found');
    return answer(await this.viewFormRevision.execute(context, { revisionId: id }));
  }

  @Post('forms/:formId/publish')
  @HttpCode(204)
  async publish(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    answer(
      await this.publishForm.execute(context, { formId: id, ...parseRequest(publishBody, body) }),
    );
  }

  @Post('forms/:formId/retire')
  @HttpCode(204)
  async retire(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    answer(
      await this.retireForm.execute(context, { formId: id, ...parseRequest(retireBody, body) }),
    );
  }

  /**
   * The form inbox, newest first. `after` is the `next` cursor of the previous page
   * (`<epoch ms>.<submission id>`).
   */
  @Get('forms/:formId/submissions')
  async listSubmissions(
    @Call() context: CallContext,
    @Param('formId') formId: string,
    @Query() query: unknown,
  ) {
    const id = idParam<'Form'>(formId, FORM_NOT_FOUND);
    const { after, limit } = parseRequest(inboxQuery, query);
    const page = answer(
      await this.listFormSubmissions.execute(context, {
        formId: id,
        after: after === undefined ? null : cursorOf(after),
        limit: limit ?? 50,
      }),
    );
    return {
      ...page,
      next:
        page.next === null ? null : `${page.next.submittedAt.epochMilliseconds}.${page.next.id}`,
    };
  }

  @Get('submissions/:submissionId')
  async viewSubmission(@Call() context: CallContext, @Param('submissionId') submissionId: string) {
    const id = idParam<'FormSubmission'>(submissionId, 'forms.submission.not-found');
    return answer(await this.viewFormSubmission.execute(context, { submissionId: id }));
  }

  /** Erases the personal data of a submission on request (owner decision D5). */
  @Post('submissions/:submissionId/erase')
  @HttpCode(204)
  async eraseSubmission(
    @Call() context: CallContext,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'FormSubmission'>(submissionId, 'forms.submission.not-found');
    answer(
      await this.eraseFormSubmission.execute(context, {
        submissionId: id,
        ...parseRequest(eraseBody, body),
      }),
    );
  }
}

/** The inbox cursor `<epoch ms>.<id>`; a malformed one is a 400. */
function cursorOf(text: string): InboxCursor {
  const [millis, id] = text.split('.');
  const parsed = parseId<'FormSubmission'>(id ?? '');
  if (!parsed.ok) return parseRequest(z.never(), text);
  return { submittedAt: Temporal.Instant.fromEpochMilliseconds(Number(millis)), id: parsed.value };
}
