import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CallContext } from '@phoenix/shared-kernel';
import { z } from 'zod';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { UpdatePortalSignInSettings } from '../application/use-cases/update-portal-sign-in-settings.use-case';
import { ViewPortalSignInSettings } from '../application/use-cases/view-portal-sign-in-settings.use-case';
import { answer, parseRequest } from './http';

const settingsBody = z.strictObject({
  version: z.number().int().min(0),
  methods: z.array(z.string().max(16)).max(4),
  countryCallingCode: z.string().max(8).nullable(),
});

/** How the tenant's portal users sign in (studio API; ADR-0026 decision 2). */
@ApiTags('identity')
@Controller('identity/portal-sign-in-settings')
export class PortalSignInSettingsController {
  constructor(
    private readonly view: ViewPortalSignInSettings,
    private readonly update: UpdatePortalSignInSettings,
  ) {}

  @Get()
  async read(@Call() context: CallContext) {
    return answer(await this.view.execute(context, undefined));
  }

  @Put()
  @HttpCode(204)
  async save(@Call() context: CallContext, @Body() body: unknown): Promise<void> {
    answer(await this.update.execute(context, parseRequest(settingsBody, body)));
  }
}
