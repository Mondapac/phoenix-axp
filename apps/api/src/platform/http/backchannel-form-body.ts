// SPIKE (PoC 2): a form-body reader for the OIDC back-channel logout route only. The global
// body parser accepts JSON only (see configure-app.ts); Keycloak posts
// application/x-www-form-urlencoded. Not compressed, at most 16 KiB, flat keys only.
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROUTE = /^\/spike\/backchannel\/[^/]+\/logout$/;
const LIMIT = 16 * 1024;

type Request = IncomingMessage & { body?: unknown; path?: string };

export function backchannelFormBody(
  request: Request,
  response: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const type = request.headers['content-type'] ?? '';
  const path = request.path ?? (request.url ?? '').split('?')[0];
  if (
    request.method !== 'POST' ||
    !ROUTE.test(path ?? '') ||
    !type.startsWith('application/x-www-form-urlencoded')
  ) {
    next();
    return;
  }
  if ((request.headers['content-encoding'] ?? 'identity') !== 'identity') {
    response.statusCode = 415;
    response.end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > LIMIT) {
      response.statusCode = 413;
      response.end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (size > LIMIT) return;
    request.body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    next();
  });
  request.on('error', next);
}
