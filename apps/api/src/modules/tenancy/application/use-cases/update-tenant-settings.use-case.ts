import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { TENANCY_SETTINGS_MANAGE } from '../../contracts/permissions';
import { TENANT_SETTINGS_CHANGED } from '../../domain/audit-actions';
import { parseMaxSiteDepth, parseSignInSources } from '../../domain/tenant-settings';
import type { DepthBelowTree, InvalidValue } from '../failures';
import type { SiteRepository } from '../site.repository';
import type { TenantSettingsRepository } from '../tenant-settings.repository';

export interface UpdateTenantSettingsInput {
  /** The version the caller read; another one answers 409 `conflict.stale`. */
  readonly version: number;
  readonly signInSources: readonly string[];
  readonly maxSiteDepth: number;
}

export type UpdateTenantSettingsFailure = InvalidValue | DepthBelowTree;

/**
 * Saves the tenant's sign-in sources (ADR-0019: directory, local or both) and its site ceiling.
 * A ceiling that existing sites already exceed is refused. The structure lock comes first, so
 * no site is created deeper while the new ceiling is checked.
 */
export class UpdateTenantSettings extends UseCase<
  UpdateTenantSettingsInput,
  void,
  UpdateTenantSettingsFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'tenancy.update-tenant-settings',
    rule: { kind: 'permissions', allOf: [TENANCY_SETTINGS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly settings: TenantSettingsRepository,
    private readonly sites: SiteRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: UpdateTenantSettingsInput,
  ): Promise<Result<void, UpdateTenantSettingsFailure>> {
    const signInSources = parseSignInSources(input.signInSources);
    if (!signInSources.ok) return Promise.resolve(signInSources);
    const maxSiteDepth = parseMaxSiteDepth(input.maxSiteDepth);
    if (!maxSiteDepth.ok) return Promise.resolve(maxSiteDepth);
    const { tenant } = context;

    return this.unitOfWork.run<void, UpdateTenantSettingsFailure>(tenant, async () => {
      const now = this.clock.now();
      const before = await this.settings.lockStructure(tenant, now);
      if ((await this.sites.deepest(tenant)) >= maxSiteDepth.value) {
        return err({ code: 'tenancy.tenant-settings.depth-below-tree' } as const);
      }
      const after = { signInSources: signInSources.value, maxSiteDepth: maxSiteDepth.value };
      await this.settings.save(tenant, input.version, after, now);
      await this.audit.record(
        context,
        TENANT_SETTINGS_CHANGED.entry('tenant', {
          before: { signInSources: before.signInSources, maxSiteDepth: before.maxSiteDepth },
          after,
        }),
      );
      return ok(undefined);
    });
  }
}
