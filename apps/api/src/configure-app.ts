import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import type { HttpLogger } from 'pino-http';
import { buildOpenApiDocument } from './openapi';
import type { AppConfig } from './platform/config/app-config';
import { APP_CONFIG } from './platform/config/config.module';
import { answerBodyError } from './platform/http/body-errors';
import { securityHeaders } from './platform/http/security-headers';
import { HTTP_LOGGER } from './platform/logging/logging.module';

/**
 * Options for creating the application, shared by the real server (main.ts) and the HTTP
 * tests. Nest's own body parser is off: `configureApp` mounts the parser after the request
 * logger.
 */
export const APP_OPTIONS = {
  bufferLogs: true,
  bodyParser: false,
} as const satisfies NestApplicationOptions;

/**
 * HTTP-level setup shared by the real server (main.ts) and the HTTP tests, so what is
 * tested is what runs. The application must be created with {@link APP_OPTIONS}.
 *
 * Order: the request logger, the security headers, the body parser, then Nest's routes and
 * guards. A request the parser rejects (malformed JSON, too large) is therefore logged with
 * its correlation id, and its answer carries the `x-correlation-id` header and the security
 * headers.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.disable('x-powered-by');
  // No proxy is trusted: `req.ip` is the socket's address; only the public forms routes read it,
  // for their rate limits (docs/platform-deferred.md, client address). Never `true`.
  app.set('trust proxy', false);
  app.enableShutdownHooks();

  app.use(app.get<HttpLogger>(HTTP_LOGGER));
  app.use(securityHeaders({ docsEnabled: config.apiDocsEnabled }));
  // JSON only, at most 64 KiB, objects and arrays only. No CORS middleware until origins exist.
  // inflate: false - a compressed body is refused with 415, never decompressed.
  app.useBodyParser('json', { limit: '64kb', strict: true, inflate: false });
  app.use(answerBodyError);

  if (config.apiDocsEnabled) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }
}
