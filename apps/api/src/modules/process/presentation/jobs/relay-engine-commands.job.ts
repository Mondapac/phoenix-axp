import { Temporal } from '@phoenix/shared-kernel';
import type { JobContext, JobDefinition } from '../../../../platform/scheduler/job-registry';
import type { RelayEngineCommands } from '../../application/use-cases/relay-engine-commands.use-case';

/**
 * `process.relay-engine-commands` (ADR-0020 decision 7): every 2 seconds, for each hosted
 * tenant, one relay pass of its engine commands. Safe to overlap: every command is claimed with
 * a lease before its engine call.
 */
export function relayEngineCommandsJob(relay: RelayEngineCommands): JobDefinition {
  return {
    name: 'process.relay-engine-commands',
    every: Temporal.Duration.from({ seconds: 2 }),
    maxRunMs: 300_000,
    async run(context: JobContext): Promise<void> {
      const result = await relay.execute(context, undefined);
      if (!result.ok) throw new Error(`process.relay-engine-commands: ${result.error.code}`);
    },
  };
}
