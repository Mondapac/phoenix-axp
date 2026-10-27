import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { TenantRegistry } from '../../../../platform/tenant-config/tenant-registry';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SETTINGS_VIEW } from '../../contracts/permissions';
import type { TenantSettings } from '../../domain/tenant-settings';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

/** The tenant's settings: its configuration (read-only here) and its editable settings. */
export interface TenantSettingsView extends TenantSettings {
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly timeZone: string;
  readonly calendar: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Locale, calendar, time zone and direction come from the tenant's configuration file
 * (ADR-02, ADR-0008) and change with a deployment; sign-in sources and the site ceiling are
 * the tenant's own and change through {@link UpdateTenantSettings}.
 */
export class ViewTenantSettings extends UseCase<void, TenantSettingsView> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.view-tenant-settings',
    rule: { kind: 'permissions', allOf: [TENANCY_SETTINGS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly tenants: TenantRegistry,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<TenantSettingsView, never>> {
    const { tenant } = context;
    const config = this.tenants.get(tenant.tenantId);
    const saved = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.settings.read(tenant)),
      {
        readOnly: true,
      },
    );
    if (!saved.ok) return saved;
    return ok({
      displayName: config.displayName,
      defaultLocale: config.defaultLocale,
      supportedLocales: config.supportedLocales,
      timeZone: config.timeZone,
      calendar: config.calendar,
      direction: config.direction,
      ...saved.value,
    });
  }
}
