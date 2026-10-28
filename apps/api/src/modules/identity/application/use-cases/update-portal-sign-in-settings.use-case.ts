import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_PORTAL_SIGN_IN_MANAGE } from '../../contracts/permissions';
import { PORTAL_SIGN_IN_SETTINGS_CHANGED } from '../../domain/audit-actions';
import {
  parseCountryCallingCode,
  parseMethods,
  type InvalidPortalValue,
  type PortalSignInSettings,
} from '../../domain/portal';
import type { PortalRepository } from '../portal/portal.repository';

export interface UpdatePortalSignInSettingsInput {
  /** The version read; 0 before the first save. */
  readonly version: number;
  readonly methods: readonly string[];
  readonly countryCallingCode: string | null;
}

const audited = (settings: Omit<PortalSignInSettings, 'version'>) => ({
  methods: settings.methods,
  countryCallingCode:
    settings.countryCallingCode === null ? null : Number(settings.countryCallingCode),
});

/**
 * Opens or closes the tenant's portal sign-in methods and sets its country calling code
 * (ADR-0026 decision 2; owner decision P1: each tenant chooses). Audited.
 */
export class UpdatePortalSignInSettings extends UseCase<
  UpdatePortalSignInSettingsInput,
  void,
  InvalidPortalValue
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.update-portal-sign-in-settings',
    rule: { kind: 'permissions', allOf: [IDENTITY_PORTAL_SIGN_IN_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: UpdatePortalSignInSettingsInput,
  ): Promise<Result<void, InvalidPortalValue>> {
    const methods = parseMethods(input.methods);
    if (!methods.ok) return Promise.resolve(methods);
    const countryCallingCode = parseCountryCallingCode(input.countryCallingCode);
    if (!countryCallingCode.ok) return Promise.resolve(countryCallingCode);
    const next = { methods: methods.value, countryCallingCode: countryCallingCode.value };
    const { tenant } = context;
    return this.unitOfWork.run<void, InvalidPortalValue>(tenant, async () => {
      const current = await this.portal.settings(tenant);
      if (current.version !== input.version) {
        throw new StaleAggregateError('identity.portal-sign-in-settings', tenant.tenantId);
      }
      if (
        current.countryCallingCode === next.countryCallingCode &&
        current.methods.join() === next.methods.join()
      ) {
        return ok(undefined);
      }
      await this.portal.saveSettings(tenant, next, current.version, this.clock.now());
      await this.audit.record(
        context,
        PORTAL_SIGN_IN_SETTINGS_CHANGED.entry('tenant', {
          before: audited(current),
          after: audited(next),
        }),
      );
      return ok(undefined);
    });
  }
}
