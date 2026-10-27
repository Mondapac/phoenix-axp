// SPIKE (PoC 2): the opaque session token (ADR-0004 decision 2). 32 random bytes, base64url;
// only its SHA-256 is stored. Hashing happens outside any unit of work.
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionTokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
