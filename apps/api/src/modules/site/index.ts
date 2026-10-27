// SPIKE: the site module's public API (contracts and the Nest module only).
export { SITE_TREE_FACADE, type SiteTreeFacade } from './contracts/site-tree.facade';
export {
  anyGrantCoversSite,
  grantCoversSite,
  type AncestorDepths,
  type ScopedGrant,
} from './contracts/subtree-access';
export { SiteModule } from './site.module';
