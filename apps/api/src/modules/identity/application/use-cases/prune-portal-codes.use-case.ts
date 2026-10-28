import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { PortalRepository } from '../portal/portal.repository';

/**
 * Deletes the sign-in codes that expired more than a day ago (ADR-0026 decision 3): kept that
 * long for a support question, then nothing of them stays. `system`: the
 * `identity.prune-portal-codes` job only.
 */
export class PrunePortalCodes extends UseCase<void, number> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.prune-portal-codes',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<number, never>> {
    const before = this.clock.now().subtract({ hours: 24 });
    return this.unitOfWork.run<number, never>(context.tenant, async () =>
      ok(await this.portal.pruneCodes(context.tenant, before)),
    );
  }
}
