import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { CreateRecord } from '../application/use-cases/create-record.use-case';
import { DeleteRecord } from '../application/use-cases/delete-record.use-case';
import { DescribeObject } from '../application/use-cases/describe-object.use-case';
import { ListRecords } from '../application/use-cases/list-records.use-case';
import { UpdateRecord } from '../application/use-cases/update-record.use-case';
import { ViewRecord } from '../application/use-cases/view-record.use-case';
import { MAX_FIELDS } from '../domain/fields';
import { answer, idField, idParam, parseRequest } from './http';

const RECORD_NOT_FOUND = 'objects.record.not-found';

/** A definition key in the path; anything else answers as an unknown definition. */
const definitionKey = (text: string): string =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 64
    ? text
    : answer({ ok: false, error: { code: 'objects.definition.not-found' } });

// Values are checked against their fields by the use case; here only the payload's size.
const values = z
  .record(z.string().max(64), z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]))
  .refine((record) => Object.keys(record).length <= MAX_FIELDS, 'too many fields');
const describeQuery = z.strictObject({ site: idField<'Site'>().optional() });
const listQuery = z.strictObject({
  site: idField<'Site'>().optional(),
  before: idField<'ObjectRecord'>().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const createBody = z.strictObject({ siteId: idField<'Site'>().optional(), values });
const updateBody = z.strictObject({ version: z.number().int().min(1), values });
const deleteQuery = z.strictObject({ version: z.coerce.number().int().min(1) });

/**
 * The generated REST API of every Object (ADR-0017 decision 7): fixed use cases serve each
 * definition by its key, so every operation has its `access` rule; fields are named by API key
 * and shown or accepted through FieldPolicy only.
 */
@ApiTags('objects')
@Controller('objects/o')
export class ObjectRecordsController {
  constructor(
    private readonly describeObject: DescribeObject,
    private readonly listRecords: ListRecords,
    private readonly viewRecord: ViewRecord,
    private readonly createRecord: CreateRecord,
    private readonly updateRecord: UpdateRecord,
    private readonly deleteRecord: DeleteRecord,
  ) {}

  /** The fields the caller may read, create or update at a site. */
  @Get(':key')
  async describe(@Call() context: CallContext, @Param('key') key: string, @Query() query: unknown) {
    const { site } = parseRequest(describeQuery, query);
    return answer(
      await this.describeObject.execute(context, {
        definitionKey: definitionKey(key),
        siteId: site ?? null,
      }),
    );
  }

  /** Newest first; `before` is the `next` of the previous page. */
  @Get(':key/records')
  async list(@Call() context: CallContext, @Param('key') key: string, @Query() query: unknown) {
    const { site, before, limit } = parseRequest(listQuery, query);
    return answer(
      await this.listRecords.execute(context, {
        definitionKey: definitionKey(key),
        siteId: site ?? null,
        before: before ?? null,
        limit: limit ?? 50,
      }),
    );
  }

  @Post(':key/records')
  async create(@Call() context: CallContext, @Param('key') key: string, @Body() body: unknown) {
    const parsed = parseRequest(createBody, body);
    return answer(
      await this.createRecord.execute(context, {
        definitionKey: definitionKey(key),
        siteId: parsed.siteId ?? null,
        values: parsed.values,
      }),
    );
  }

  @Get(':key/records/:recordId')
  async view(
    @Call() context: CallContext,
    @Param('key') key: string,
    @Param('recordId') recordId: string,
  ) {
    const id = idParam<'ObjectRecord'>(recordId, RECORD_NOT_FOUND);
    return answer(
      await this.viewRecord.execute(context, { definitionKey: definitionKey(key), recordId: id }),
    );
  }

  @Patch(':key/records/:recordId')
  async update(
    @Call() context: CallContext,
    @Param('key') key: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const id = idParam<'ObjectRecord'>(recordId, RECORD_NOT_FOUND);
    return answer(
      await this.updateRecord.execute(context, {
        definitionKey: definitionKey(key),
        recordId: id,
        ...parseRequest(updateBody, body),
      }),
    );
  }

  @Delete(':key/records/:recordId')
  @HttpCode(204)
  async remove(
    @Call() context: CallContext,
    @Param('key') key: string,
    @Param('recordId') recordId: string,
    @Query() query: unknown,
  ): Promise<void> {
    const id = idParam<'ObjectRecord'>(recordId, RECORD_NOT_FOUND);
    const { version } = parseRequest(deleteQuery, query);
    answer(
      await this.deleteRecord.execute(context, {
        definitionKey: definitionKey(key),
        recordId: id,
        version,
      }),
    );
  }
}
