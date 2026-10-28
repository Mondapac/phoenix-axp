import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Id, TenantContext } from '@phoenix/shared-kernel';
import { CODE_DIGITS } from '../../domain/portal';

// The one-time codes of portal sign-in (ADR-0026 decision 3): uniformly random digits, stored
// only as an HMAC bound to the tenant and the code's id, under a key derived from
// SESSION_SECRET for this purpose only. CPU work: callers run it outside their unit.

const CODE = new RegExp(`^[0-9]{${CODE_DIGITS}}$`);

export class PortalCodes {
  readonly #key: Buffer;

  constructor(sessionSecret: Buffer) {
    this.#key = createHmac('sha256', sessionSecret).update('portal-sign-in-code').digest();
  }

  issue(): string {
    return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
  }

  /** The stored form of `code` for the challenge `id`; null for a malformed code. */
  hash(tenant: TenantContext, id: Id<'PortalCode'>, code: string): Buffer | null {
    if (!CODE.test(code)) return null;
    return createHmac('sha256', this.#key)
      .update(`${tenant.tenantId}\u0000${id}\u0000${code}`)
      .digest();
  }

  static matches(stored: Buffer, candidate: Buffer | null): boolean {
    return (
      candidate !== null && stored.length === candidate.length && timingSafeEqual(stored, candidate)
    );
  }
}

export const PORTAL_CODES = Symbol('PORTAL_CODES');
