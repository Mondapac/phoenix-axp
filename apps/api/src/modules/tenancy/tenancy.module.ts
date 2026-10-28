import { Module, type Provider } from '@nestjs/common';
import { registerAuditActions } from '../../platform/audit/audit-action-catalogue';
import { AUDIT_WRITER } from '../../platform/audit/audit-writer';
import {
  registerPermissions,
  SITE_ANCESTRY_READER,
  USE_CASE_GATE,
  type UseCaseGate,
} from '../../platform/authz';
import { CLOCK } from '../../platform/clock/clock.module';
import { ID_GENERATOR } from '../../platform/ids/ids.module';
import { PersistenceModule } from '../../platform/persistence/persistence.module';
import { TenantRegistry } from '../../platform/tenant-config/tenant-registry';
import { UNIT_OF_WORK } from '../../platform/unit-of-work/unit-of-work';
import { ORGANIZATION_REPOSITORY } from './application/organization.repository';
import { SITE_REPOSITORY } from './application/site.repository';
import { TENANT_SETTINGS_REPOSITORY } from './application/tenant-settings.repository';
import { AddSiteDomain } from './application/use-cases/add-site-domain.use-case';
import { CreateOrganization } from './application/use-cases/create-organization.use-case';
import { CreateSite } from './application/use-cases/create-site.use-case';
import { ListOrganizations } from './application/use-cases/list-organizations.use-case';
import { ListSites } from './application/use-cases/list-sites.use-case';
import { MoveOrganization } from './application/use-cases/move-organization.use-case';
import { MoveSite } from './application/use-cases/move-site.use-case';
import { RemoveSiteDomain } from './application/use-cases/remove-site-domain.use-case';
import { RenameOrganization } from './application/use-cases/rename-organization.use-case';
import { UpdateSite } from './application/use-cases/update-site.use-case';
import { UpdateTenantSettings } from './application/use-cases/update-tenant-settings.use-case';
import { ViewSite } from './application/use-cases/view-site.use-case';
import { ViewTenantPresentation } from './application/use-cases/view-tenant-presentation.use-case';
import { ViewTenantSettings } from './application/use-cases/view-tenant-settings.use-case';
import { TENANCY_PERMISSIONS } from './contracts/permissions';
import { TENANCY_AUDIT_ACTIONS } from './domain/audit-actions';
import { PrismaOrganizationRepository } from './infrastructure/prisma-organization.repository';
import { PrismaSiteRepository } from './infrastructure/prisma-site.repository';
import { PrismaTenantSettingsRepository } from './infrastructure/prisma-tenant-settings.repository';
import { ClosureSiteAncestryReader } from './infrastructure/site-ancestry.reader';
import { OrganizationsController } from './presentation/organizations.controller';
import { SitesController } from './presentation/sites.controller';
import {
  TenantPresentationController,
  TenantSettingsController,
} from './presentation/tenant-settings.controller';

const SITES = { provide: SITE_REPOSITORY, useClass: PrismaSiteRepository };

/**
 * The tenancy module's answer to platform/authz: `SITE_ANCESTRY_READER` over the site closure
 * table. Passed to `AuthzModule.register({ siteAncestry })` by app.module.ts, so platform/
 * imports no module; it needs only the global persistence providers.
 */
@Module({
  providers: [SITES, { provide: SITE_ANCESTRY_READER, useClass: ClosureSiteAncestryReader }],
  exports: [SITE_ANCESTRY_READER],
})
export class TenancySiteAncestryModule {}

/** Each use case built with the gate first and its ports after, in constructor order. */
function useCase(type: abstract new (...args: never[]) => unknown, inject: unknown[]): Provider {
  return {
    provide: type,
    inject: [USE_CASE_GATE, UNIT_OF_WORK, ...inject] as never[],
    useFactory: (...deps: unknown[]) =>
      new (type as unknown as new (...args: unknown[]) => unknown)(...deps),
  };
}

const SETTINGS = TENANT_SETTINGS_REPOSITORY;
const ORGANIZATIONS = ORGANIZATION_REPOSITORY;

/**
 * The tenancy module (Phase 1 slice 1.4): the site tree, the organization chart, site domains
 * and the tenant's settings, behind the studio API. Its audit writer stays inside the module.
 */
@Module({
  controllers: [
    SitesController,
    OrganizationsController,
    TenantSettingsController,
    TenantPresentationController,
  ],
  providers: [
    registerPermissions('tenancy', TENANCY_PERMISSIONS),
    registerAuditActions('tenancy', TENANCY_AUDIT_ACTIONS),
    PersistenceModule.auditWriterFor('tenancy'),
    SITES,
    { provide: ORGANIZATIONS, useClass: PrismaOrganizationRepository },
    { provide: SETTINGS, useClass: PrismaTenantSettingsRepository },
    useCase(ListSites, [SITE_REPOSITORY]),
    useCase(ViewSite, [SITE_REPOSITORY]),
    useCase(CreateSite, [
      SETTINGS,
      SITE_REPOSITORY,
      ORGANIZATIONS,
      AUDIT_WRITER,
      CLOCK,
      ID_GENERATOR,
    ]),
    useCase(UpdateSite, [SITE_REPOSITORY, ORGANIZATIONS, AUDIT_WRITER, CLOCK]),
    useCase(MoveSite, [SETTINGS, SITE_REPOSITORY, AUDIT_WRITER, CLOCK]),
    useCase(AddSiteDomain, [SITE_REPOSITORY, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(RemoveSiteDomain, [SITE_REPOSITORY, AUDIT_WRITER]),
    useCase(ListOrganizations, [ORGANIZATIONS]),
    useCase(CreateOrganization, [SETTINGS, ORGANIZATIONS, AUDIT_WRITER, CLOCK, ID_GENERATOR]),
    useCase(RenameOrganization, [ORGANIZATIONS, AUDIT_WRITER, CLOCK]),
    useCase(MoveOrganization, [SETTINGS, ORGANIZATIONS, AUDIT_WRITER, CLOCK]),
    useCase(ViewTenantSettings, [SETTINGS, TenantRegistry]),
    {
      provide: ViewTenantPresentation,
      inject: [USE_CASE_GATE, TenantRegistry],
      useFactory: (gate: UseCaseGate, tenants: TenantRegistry) =>
        new ViewTenantPresentation(gate, tenants),
    },
    useCase(UpdateTenantSettings, [SETTINGS, SITE_REPOSITORY, AUDIT_WRITER, CLOCK]),
  ],
})
export class TenancyModule {}
