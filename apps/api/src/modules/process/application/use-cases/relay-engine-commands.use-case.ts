import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { CommandRelay, RelayPass } from '../bridge/command-relay';

/**
 * One relay pass of a tenant's engine commands (ADR-0020 decision 7). `system`: called by the
 * `process.relay-engine-commands` job only.
 */
export class RelayEngineCommands extends UseCase<void, RelayPass> {
  static override readonly access: AccessDeclaration = {
    name: 'process.relay-engine-commands',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly relay: CommandRelay,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<RelayPass, never>> {
    return ok(await this.relay.runOnce(context));
  }
}
