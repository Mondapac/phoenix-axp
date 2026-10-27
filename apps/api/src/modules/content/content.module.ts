// SPIKE: the content module.
import { Module } from '@nestjs/common';
import { CONTENT_STORE } from './application/ports/content-store';
import { ListSiteContent } from './application/use-cases/list-site-content.use-case';
import { ContentRepository } from './infrastructure/content.repository';
import { ContentController } from './presentation/content.controller';

@Module({
  controllers: [ContentController],
  providers: [{ provide: CONTENT_STORE, useClass: ContentRepository }, ListSiteContent],
})
export class ContentModule {}
