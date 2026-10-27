// The values of one Authorization Code + PKCE flow (ADR-0004 decision 1; from the PoC 2 spike,
// as Mondapac's SignInProviderFlowSecrets): derived by HMAC from a random flow secret held in
// the browser's flow cookie, so nothing of a pending sign-in is stored on the server. The key
// is derived from SESSION_SECRET for this purpose only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '@phoenix/shared-kernel';

export interface SignInFlow {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

const FLOW_SECRET = /^[A-Za-z0-9_-]{43}$/;

export class SignInFlows {
  readonly #key: Buffer;

  constructor(sessionSecret: Buffer) {
    this.#key = createHmac('sha256', sessionSecret).update('sign-in-flow').digest();
  }

  issue(): string {
    return randomBytes(32).toString('base64url');
  }

  /** The flow of a secret, bound to the tenant; null for a malformed secret. */
  derive(secret: string, tenant: TenantContext): SignInFlow | null {
    if (!FLOW_SECRET.test(secret)) return null;
    const part = (purpose: string) =>
      createHmac('sha256', this.#key)
        .update(`${purpose}\u0000${tenant.tenantId}\u0000${secret}`)
        .digest('base64url');
    const codeVerifier = part('pkce-verifier');
    return {
      state: part('state'),
      nonce: part('nonce'),
      codeVerifier,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    };
  }

  stateMatches(flow: SignInFlow, presented: string): boolean {
    const a = Buffer.from(flow.state);
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export const SIGN_IN_FLOWS = Symbol('SIGN_IN_FLOWS');
