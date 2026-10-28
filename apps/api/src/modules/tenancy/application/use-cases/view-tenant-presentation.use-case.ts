import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { TenantRegistry } from '../../../../platform/tenant-config/tenant-registry';

/** How a panel presents the tenant: its name, languages, direction, calendar and time zone. */
export interface TenantPresentation {
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly direction: 'ltr' | 'rtl';
  readonly calendar: string;
  readonly timeZone: string;
}

/**
 * The tenant's presentation, from its configuration file (ADR-0002, ADR-0008), which the panels
 * render every page with, the sign-in page included (slice 1.10). `anonymous`: it is shown
 * before sign-in and holds nothing the tenant's own sign-in page does not show; the tenant is
 * the request's, resolved from `x-tenant-id`, and the settings the tenant edits stay behind
 * {@link ViewTenantSettings}.
 */
export class ViewTenantPresentation extends UseCase<void, TenantPresentation, never> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.view-tenant-presentation',
    rule: { kind: 'anonymous' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly tenants: TenantRegistry,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<TenantPresentation, never>> {
    const config = this.tenants.get(context.tenant.tenantId);
    return Promise.resolve(
      ok({
        displayName: config.displayName,
        defaultLocale: config.defaultLocale,
        supportedLocales: config.supportedLocales,
        direction: config.direction,
        calendar: config.calendar,
        timeZone: config.timeZone,
      }),
    );
  }
}
