import 'reflect-metadata';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { databaseAccepted } from './check-database-role';
import { loadEnvFile } from './load-env-file';
import {
  commandFailureLine,
  OPERATOR_COMMAND_EXIT,
  runOperatorCommand,
} from './platform/commands/run-operator-command';
import { InvalidConfigError, loadAppConfig } from './platform/config/app-config';
import { DatabaseProbe } from './platform/persistence/database-probe';
import {
  boundPlaceholders,
  placeholdersAccepted,
} from './platform/placeholders/bound-placeholders';

/**
 * The operator command runner of the api image:
 * `APP_ROLE=api node dist/run-command.js <module>.<command> --tenant <id> [arguments]`. It loads
 * the api's configuration (so `APP_ROLE` is required, with no default), builds the same module
 * graph, runs the start-up self-checks of the api (a production start with a fail-closed
 * placeholder bound is refused, because a command runs use cases; the database role check),
 * then runs the one named command for the one named tenant (platform/commands). Exit 0 on
 * success, 1 when refused, 3 when the command failed; a command documents any other code. No
 * HTTP listener, no worker runtime.
 */
async function main(): Promise<number> {
  loadEnvFile();
  const config = loadAppConfig(process.env);
  const context = await NestFactory.createApplicationContext(AppModule.register({ config }), {
    bufferLogs: true,
  });
  try {
    const logger = context.get(Logger);
    context.useLogger(logger);
    if (
      !placeholdersAccepted(boundPlaceholders(context.get(ModulesContainer)), config, logger) ||
      !(await databaseAccepted(context.get(DatabaseProbe), logger))
    ) {
      return OPERATOR_COMMAND_EXIT.refused;
    }
    return await runOperatorCommand(
      context,
      process.argv.slice(2),
      (line) => process.stdout.write(`${line}\n`),
      (line) => process.stderr.write(`${line}\n`),
      logger,
    );
  } finally {
    await context.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A failed start: only the configuration's own text (it names variables, never values).
    process.stderr.write(
      `${error instanceof InvalidConfigError ? error.message : commandFailureLine('run-command', error)}\n`,
    );
    process.exit(OPERATOR_COMMAND_EXIT.refused);
  },
);
