import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { ViewTenantPresentation } from '../application/use-cases/view-tenant-presentation.use-case';
import { UpdateTenantSettings } from '../application/use-cases/update-tenant-settings.use-case';
import { ViewTenantSettings } from '../application/use-cases/view-tenant-settings.use-case';
import { answer, parseRequest } from './http';

const updateBody = z.strictObject({
  version: z.number().int().min(1),
  signInSources: z.array(z.string().max(32)).max(8),
  maxSiteDepth: z.number().int(),
});

/** The caller's tenant settings (studio API). */
@ApiTags('tenancy')
@Controller('tenancy/settings')
export class TenantSettingsController {
  constructor(
    private readonly viewTenantSettings: ViewTenantSettings,
    private readonly updateTenantSettings: UpdateTenantSettings,
  ) {}

  @Get()
  async view(@Call() context: CallContext) {
    return answer(await this.viewTenantSettings.execute(context, undefined));
  }

  @Put()
  @HttpCode(204)
  async update(@Call() context: CallContext, @Body() body: unknown): Promise<void> {
    answer(await this.updateTenantSettings.execute(context, parseRequest(updateBody, body)));
  }
}

/** How the panels present the request's tenant, before and after sign-in. */
@ApiTags('tenancy')
@Controller('tenancy/presentation')
export class TenantPresentationController {
  constructor(private readonly viewTenantPresentation: ViewTenantPresentation) {}

  @Get()
  async view(@Call() context: CallContext) {
    return answer(await this.viewTenantPresentation.execute(context, undefined));
  }
}
