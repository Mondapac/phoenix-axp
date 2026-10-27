import { ModulesContainer, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { AppModule } from './app.module';
import { databaseAccepted } from './check-database-role';
import { APP_OPTIONS, configureApp } from './configure-app';
import type { AppConfig } from './platform/config/app-config';
import { DatabaseProbe } from './platform/persistence/database-probe';
import {
  boundPlaceholders,
  placeholdersAccepted,
} from './platform/placeholders/bound-placeholders';

/** Where a start function writes its log lines; stdout unless a test passes a stream. */
export interface StartOptions {
  readonly logDestination?: DestinationStream;
}

/**
 * The `api` role: the HTTP server with its guards, controllers and docs. Returns `undefined`,
 * with the application closed, when the start-up self-check refuses.
 */
export async function startApi(
  config: AppConfig,
  options: StartOptions = {},
): Promise<NestExpressApplication | undefined> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ config, logDestination: options.logDestination }),
    APP_OPTIONS,
  );
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);

  // Before listening, so a mis-wired database secret never serves a request, and a database
  // whose default isolation is not READ COMMITTED never runs a unit.
  // Phoenix ADR-0010 decision 4: the bound placeholder set is logged, and a production start
  // with one bound is refused.
  if (
    !placeholdersAccepted(boundPlaceholders(app.get(ModulesContainer)), config, logger) ||
    !(await databaseAccepted(app.get(DatabaseProbe), logger))
  ) {
    await app.close();
    return undefined;
  }

  await app.listen(config.port);
  return app;
}
