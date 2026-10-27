import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { EngineSync, SyncPass } from '../bridge/engine-sync';

/**
 * One sync pass of a tenant's engine state into the core (PoC 3 R5). `system`: called by the
 * `process.sync-engine` job only.
 */
export class SyncEngine extends UseCase<void, SyncPass> {
  static override readonly access: AccessDeclaration = {
    name: 'process.sync-engine',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly sync: EngineSync,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<SyncPass, never>> {
    return ok(await this.sync.runOnce(context));
  }
}
