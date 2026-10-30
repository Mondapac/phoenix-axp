import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { CreateDefinition } from '../application/use-cases/create-definition.use-case';
import { ListDefinitions } from '../application/use-cases/list-definitions.use-case';
import { PublishDefinition } from '../application/use-cases/publish-definition.use-case';
import { RenameDefinition } from '../application/use-cases/rename-definition.use-case';
import { RetireDefinition } from '../application/use-cases/retire-definition.use-case';
import { SaveRevision } from '../application/use-cases/save-revision.use-case';
import { ViewDefinition } from '../application/use-cases/view-definition.use-case';
import { ViewRevision } from '../application/use-cases/view-revision.use-case';
import { FIELD_TYPES, MAX_FIELDS, MAX_OPTIONS, PORTAL_MODES } from '../domain/fields';
import { DEFINITION_STATUSES } from '../domain/lifecycle';
import { answer, idField, idParam, parseRequest } from './http';
import {
  ApiRefusals,
  CreatedIdBody,
  CreateDefinitionRequest,
  DefinitionDetailBody,
  DefinitionListBody,
  PublishDefinitionRequest,
  RenameDefinitionRequest,
  RetireDefinitionRequest,
  RevisionBody,
  SavedRevisionBody,
  SaveRevisionRequest,
} from './openapi';

const DEFINITION_NOT_FOUND = 'objects.definition.not-found';

const listQuery = z.strictObject({
  site: idField<'Site'>().optional(),
  status: z.enum(DEFINITION_STATUSES).optional(),
});
const createBody = z.strictObject({
  siteId: idField<'Site'>(),
  key: z.string().max(256),
  name: z.string().max(1024),
});
const renameBody = z.strictObject({
  version: z.number().int().min(1),
  name: z.string().max(1024),
});
// The field rules are the use case's; the shape and sizes are checked here.
const fieldBody = z.strictObject({
  id: idField<'Field'>().optional(),
  key: z.string().max(256),
  label: z.string().max(1024),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  portal: z.enum(PORTAL_MODES).optional(),
  options: z
    .array(z.strictObject({ key: z.string().max(256), label: z.string().max(1024) }))
    .max(MAX_OPTIONS)
    .optional(),
  maxLength: z.number().int().optional(),
});
const revisionBody = z.strictObject({ fields: z.array(fieldBody).max(MAX_FIELDS) });
const publishBody = z.strictObject({
  version: z.number().int().min(1),
  revisionId: idField<'ObjectRevision'>(),
});
const retireBody = z.strictObject({ version: z.number().int().min(1) });

/** The Object definitions of the caller's tenant (studio API; ADR-0017 decision 2). */
@ApiTags('objects')
@Controller('objects')
export class ObjectDefinitionsController {
  constructor(
    private readonly listDefinitions: ListDefinitions,
    private readonly viewDefinition: ViewDefinition,
    private readonly createDefinition: CreateDefinition,
    private readonly renameDefinition: RenameDefinition,
    private readonly saveRevision: SaveRevision,
    private readonly viewRevision: ViewRevision,
    private readonly publishDefinition: PublishDefinition,
    private readonly retireDefinition: RetireDefinition,
  ) {}

  @Get('definitions')
  @ApiOperation({ summary: 'List the definitions the caller may view, by name' })
  @ApiQuery({ name: 'site', required: false, description: 'Only the definitions of this site.' })
  @ApiQuery({ name: 'status', required: false, enum: DEFINITION_STATUSES })
  @ApiOkResponse({ type: DefinitionListBody })
  @ApiRefusals(400, 401, 403)
  async list(@Call() context: CallContext, @Query() query: unknown) {
    const { site, status } = parseRequest(listQuery, query);
    return {
      items: answer(
        await this.listDefinitions.execute(context, {
          siteId: site ?? null,
          status: status ?? null,
        }),
      ),
    };
  }

  @Post('definitions')
  @ApiOperation({ summary: 'Create a definition (a draft, with no revision yet)' })
  @ApiBody({ type: CreateDefinitionRequest })
  @ApiCreatedResponse({ type: CreatedIdBody })
  @ApiRefusals(400, 401, 403, 404, 409)
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.createDefinition.execute(context, parseRequest(createBody, body)));
  }

  @Get('definitions/:definitionId')
  @ApiOperation({ summary: 'View a definition and its revisions' })
  @ApiOkResponse({ type: DefinitionDetailBody })
  @ApiRefusals(401, 403, 404)
  async view(@Call() context: CallContext, @Param('definitionId') definitionId: string) {
    const id = idParam<'ObjectDefinition'>(definitionId, DEFINITION_NOT_FOUND);
    return answer(await this.viewDefinition.execute(context, { definitionId: id }));
  }

  @Patch('definitions/:definitionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Rename a definition' })
  @ApiBody({ type: RenameDefinitionRequest })
  @ApiNoContentResponse({ description: 'Renamed' })
  @ApiRefusals(400, 401, 403, 404, 409)
  async rename(
    @Call() context: CallContext,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'ObjectDefinition'>(definitionId, DEFINITION_NOT_FOUND);
    answer(
      await this.renameDefinition.execute(context, {
        definitionId: id,
        ...parseRequest(renameBody, body),
      }),
    );
  }

  @Post('definitions/:definitionId/revisions')
  @ApiOperation({ summary: 'Save the next revision of a definition (does not publish it)' })
  @ApiBody({ type: SaveRevisionRequest })
  @ApiCreatedResponse({ type: SavedRevisionBody })
  @ApiRefusals(400, 401, 403, 404, 409)
  async saveRevisionOf(
    @Call() context: CallContext,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ) {
    const id = idParam<'ObjectDefinition'>(definitionId, DEFINITION_NOT_FOUND);
    return answer(
      await this.saveRevision.execute(context, {
        definitionId: id,
        ...parseRequest(revisionBody, body),
      }),
    );
  }

  @Get('revisions/:revisionId')
  @ApiOperation({ summary: 'View a revision and its fields' })
  @ApiOkResponse({ type: RevisionBody })
  @ApiRefusals(401, 403, 404)
  async viewRevisionOf(@Call() context: CallContext, @Param('revisionId') revisionId: string) {
    const id = idParam<'ObjectRevision'>(revisionId, 'objects.revision.not-found');
    return answer(await this.viewRevision.execute(context, { revisionId: id }));
  }

  @Post('definitions/:definitionId/publish')
  @HttpCode(204)
  @ApiOperation({ summary: 'Publish a revision: new records and every later change use it' })
  @ApiBody({ type: PublishDefinitionRequest })
  @ApiNoContentResponse({ description: 'Published' })
  @ApiRefusals(400, 401, 403, 404, 409)
  async publish(
    @Call() context: CallContext,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'ObjectDefinition'>(definitionId, DEFINITION_NOT_FOUND);
    answer(
      await this.publishDefinition.execute(context, {
        definitionId: id,
        ...parseRequest(publishBody, body),
      }),
    );
  }

  @Post('definitions/:definitionId/retire')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire a definition: its records stay readable, none is written' })
  @ApiBody({ type: RetireDefinitionRequest })
  @ApiNoContentResponse({ description: 'Retired' })
  @ApiRefusals(400, 401, 403, 404, 409)
  async retire(
    @Call() context: CallContext,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'ObjectDefinition'>(definitionId, DEFINITION_NOT_FOUND);
    answer(
      await this.retireDefinition.execute(context, {
        definitionId: id,
        ...parseRequest(retireBody, body),
      }),
    );
  }
}
