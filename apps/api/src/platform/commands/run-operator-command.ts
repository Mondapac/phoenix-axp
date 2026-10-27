import type { INestApplicationContext, LoggerService } from '@nestjs/common';
import { parseCorrelationId } from '@phoenix/shared-kernel';
import type { IdGenerator } from '@phoenix/shared-kernel';
import { createCallContext, systemActor } from '@phoenix/shared-kernel/contexts';
import { ID_GENERATOR } from '../ids/ids.module';
import { reduceDatabaseError } from '../persistence/database-error';
import { TenantContextFactory } from '../tenant-context/tenant-context.factory';
import { CommandRegistry, type CommandContext } from './command-registry';

/** The exit codes the runner itself answers; a command adds its own (command-registry.ts). */
export const OPERATOR_COMMAND_EXIT = Object.freeze({
  /** A usage error, an unknown command, a tenant this stack does not host, or a failed start. */
  refused: 1,
  /** The command threw after the start-up checks: the outcome is unknown. */
  failed: 3,
});

const USAGE = 'usage: run-command <module>.<command> --tenant <id> [arguments]';

/**
 * The operator command runner of the api image (`run-command <name> --tenant <id> ...`): the
 * named command from the registry, the named tenant's context from the factory (a tenant this
 * stack does not host is refused), the system actor and a new correlation id, then one run.
 * Operator input is never echoed. A command that throws gets one fixed line with the error's
 * class and SQLSTATE only, never its message. The outcome is logged with the command name,
 * tenant, correlation id and exit code, so a run can be traced to the audit entries it wrote.
 */
export async function runOperatorCommand(
  app: INestApplicationContext,
  argv: readonly string[],
  write: (line: string) => void,
  writeError: (line: string) => void,
  logger: LoggerService,
): Promise<number> {
  const registry = app.get(CommandRegistry);
  const [name, flag, tenantCode, ...rest] = argv;
  const command = name === undefined ? undefined : registry.get(name);
  if (command === undefined || flag !== '--tenant' || tenantCode === undefined) {
    write(USAGE);
    write(`commands: ${registry.names().join(', ')}`);
    return OPERATOR_COMMAND_EXIT.refused;
  }
  const tenant = app.get(TenantContextFactory).forTenant(tenantCode);
  const correlationId = parseCorrelationId(
    app.get<IdGenerator>(ID_GENERATOR).next<'operator-command'>(),
  );
  if (!tenant.ok || !correlationId.ok) {
    write(`${command.name}: that tenant is not hosted by this stack`);
    return OPERATOR_COMMAND_EXIT.refused;
  }
  const context: CommandContext = createCallContext(
    tenant.value,
    systemActor(tenant.value),
    correlationId.value,
  );
  let exitCode: number;
  try {
    exitCode = await command.run(context, rest, write);
  } catch (error) {
    writeError(commandFailureLine(command.name, error));
    exitCode = OPERATOR_COMMAND_EXIT.failed;
  }
  logger.log({
    msg: 'operator.command.ran',
    command: command.name,
    tenantId: tenant.value.tenantId,
    correlationId: correlationId.value,
    exitCode,
  });
  return exitCode;
}

const CLASS_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** One fixed line for an error: its class and, for a database error, its SQLSTATE. */
export function commandFailureLine(command: string, error: unknown): string {
  const name = error instanceof Error && CLASS_NAME.test(error.name) ? error.name : 'Error';
  const sqlState = reduceDatabaseError(error)?.sqlState;
  return `${command}: the command did not complete (${name}${sqlState === undefined ? '' : `, SQLSTATE ${sqlState}`})`;
}
