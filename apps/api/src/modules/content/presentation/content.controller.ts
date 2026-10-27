// SPIKE (PoC 2): the studio endpoint. Guards only authenticate; the use case authorises.
import { Controller, Get, Param } from '@nestjs/common';
import type { CallContext } from '@phoenix/shared-kernel';
import { httpFailure } from '../../../platform/authz';
import { Call } from '../../../platform/call-context/call-context.decorator';
import { ListSiteContent } from '../application/use-cases/list-site-content.use-case';

@Controller('spike/studio/sites')
export class ContentController {
  constructor(private readonly listSiteContent: ListSiteContent) {}

  @Get(':siteId/content')
  async list(@Call() call: CallContext, @Param('siteId') siteId: string) {
    const result = await this.listSiteContent.execute(call, { siteId });
    if (!result.ok) throw httpFailure(result.error, { 'site.not-found': 404 });
    return result.value;
  }
}
