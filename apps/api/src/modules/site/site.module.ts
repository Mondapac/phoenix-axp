// SPIKE: the site module (tree only).
import { Global, Module } from '@nestjs/common';
import { SITE_TREE_FACADE } from './contracts/site-tree.facade';
import { SiteTreeRepository } from './infrastructure/site-tree.repository';

@Global()
@Module({
  providers: [{ provide: SITE_TREE_FACADE, useClass: SiteTreeRepository }],
  exports: [SITE_TREE_FACADE],
})
export class SiteModule {}
