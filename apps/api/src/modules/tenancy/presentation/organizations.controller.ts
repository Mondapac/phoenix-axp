import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { CreateOrganization } from '../application/use-cases/create-organization.use-case';
import { ListOrganizations } from '../application/use-cases/list-organizations.use-case';
import { MoveOrganization } from '../application/use-cases/move-organization.use-case';
import { RenameOrganization } from '../application/use-cases/rename-organization.use-case';
import { answer, idField, idParam, parseRequest } from './http';

const NOT_FOUND = 'tenancy.organization.not-found';

const createBody = z.strictObject({
  parentId: idField<'Organization'>().nullable(),
  name: z.string().max(1024),
});
const renameBody = z.strictObject({ version: z.number().int().min(1), name: z.string().max(1024) });
const moveBody = z.strictObject({ newParentId: idField<'Organization'>().nullable() });

/** The organization chart of the caller's tenant (studio API; ADR-0018 decision 3). */
@ApiTags('tenancy')
@Controller('tenancy/organizations')
export class OrganizationsController {
  constructor(
    private readonly listOrganizations: ListOrganizations,
    private readonly createOrganization: CreateOrganization,
    private readonly renameOrganization: RenameOrganization,
    private readonly moveOrganization: MoveOrganization,
  ) {}

  @Get()
  async list(@Call() context: CallContext) {
    return { items: answer(await this.listOrganizations.execute(context, undefined)) };
  }

  @Post()
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.createOrganization.execute(context, parseRequest(createBody, body)));
  }

  @Patch(':organizationId')
  @HttpCode(204)
  async rename(
    @Call() context: CallContext,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Organization'>(organizationId, NOT_FOUND);
    answer(
      await this.renameOrganization.execute(context, {
        organizationId: id,
        ...parseRequest(renameBody, body),
      }),
    );
  }

  @Post(':organizationId/move')
  @HttpCode(204)
  async move(
    @Call() context: CallContext,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Organization'>(organizationId, NOT_FOUND);
    answer(
      await this.moveOrganization.execute(context, {
        organizationId: id,
        ...parseRequest(moveBody, body),
      }),
    );
  }
}
