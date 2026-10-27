import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { AddSiteDomain } from '../application/use-cases/add-site-domain.use-case';
import { CreateSite } from '../application/use-cases/create-site.use-case';
import { ListSites } from '../application/use-cases/list-sites.use-case';
import { MoveSite } from '../application/use-cases/move-site.use-case';
import { RemoveSiteDomain } from '../application/use-cases/remove-site-domain.use-case';
import { UpdateSite } from '../application/use-cases/update-site.use-case';
import { ViewSite } from '../application/use-cases/view-site.use-case';
import { answer, idField, idParam, parseRequest } from './http';

const SITE_NOT_FOUND = 'tenancy.site.not-found';

const listQuery = z.strictObject({ root: idField<'Site'>().optional() });
const createBody = z.strictObject({
  parentSiteId: idField<'Site'>().nullable(),
  organizationId: idField<'Organization'>().nullable(),
  slug: z.string().max(256),
  name: z.string().max(1024),
});
const updateBody = z.strictObject({
  version: z.number().int().min(1),
  name: z.string().max(1024),
  organizationId: idField<'Organization'>().nullable(),
});
const moveBody = z.strictObject({ newParentSiteId: idField<'Site'>().nullable() });
const domainBody = z.strictObject({
  hostname: z.string().max(512),
  pathPrefix: z.string().max(512).default(''),
});

/** The site tree of the caller's tenant (studio API; ADR-0018). */
@ApiTags('tenancy')
@Controller('tenancy')
export class SitesController {
  constructor(
    private readonly listSites: ListSites,
    private readonly viewSite: ViewSite,
    private readonly createSite: CreateSite,
    private readonly updateSite: UpdateSite,
    private readonly moveSite: MoveSite,
    private readonly addSiteDomain: AddSiteDomain,
    private readonly removeSiteDomain: RemoveSiteDomain,
  ) {}

  @Get('sites')
  async list(@Call() context: CallContext, @Query() query: unknown) {
    const { root } = parseRequest(listQuery, query);
    return { items: answer(await this.listSites.execute(context, { rootSiteId: root ?? null })) };
  }

  @Post('sites')
  async create(@Call() context: CallContext, @Body() body: unknown) {
    return answer(await this.createSite.execute(context, parseRequest(createBody, body)));
  }

  @Get('sites/:siteId')
  async view(@Call() context: CallContext, @Param('siteId') siteId: string) {
    const id = idParam<'Site'>(siteId, SITE_NOT_FOUND);
    return answer(await this.viewSite.execute(context, { siteId: id }));
  }

  @Patch('sites/:siteId')
  @HttpCode(204)
  async update(
    @Call() context: CallContext,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Site'>(siteId, SITE_NOT_FOUND);
    answer(
      await this.updateSite.execute(context, { siteId: id, ...parseRequest(updateBody, body) }),
    );
  }

  @Post('sites/:siteId/move')
  @HttpCode(204)
  async move(
    @Call() context: CallContext,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const id = idParam<'Site'>(siteId, SITE_NOT_FOUND);
    answer(await this.moveSite.execute(context, { siteId: id, ...parseRequest(moveBody, body) }));
  }

  @Post('sites/:siteId/domains')
  async addDomain(
    @Call() context: CallContext,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ): Promise<{ id: Id<'SiteDomain'> }> {
    const id = idParam<'Site'>(siteId, SITE_NOT_FOUND);
    return answer(
      await this.addSiteDomain.execute(context, { siteId: id, ...parseRequest(domainBody, body) }),
    );
  }

  @Delete('site-domains/:domainId')
  @HttpCode(204)
  async removeDomain(
    @Call() context: CallContext,
    @Param('domainId') domainId: string,
  ): Promise<void> {
    const id = idParam<'SiteDomain'>(domainId, 'tenancy.site-domain.not-found');
    answer(await this.removeSiteDomain.execute(context, { domainId: id }));
  }
}
