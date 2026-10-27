import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { err, ok, Temporal } from '@phoenix/shared-kernel';
import type { Clock, Result, TenantContext } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../unit-of-work/unit-of-work';

// A self-hosted CAPTCHA without images (phase 2 review, team decision: proof of work, as
// ALTCHA, MIT): the server hands out a signed challenge, the browser searches for the number
// whose SHA-256 with the salt gives the challenge, and the server checks the answer once. The
// wire format is ALTCHA's (v1), so its open-source widget can solve it; the server side is
// written here on node:crypto, with no dependency. Nothing about the client is stored.

/** A challenge as the browser receives it (ALTCHA's `Challenge`). */
export interface ProofOfWorkChallenge {
  readonly algorithm: 'SHA-256';
  /** Hex SHA-256 of `salt + number`. */
  readonly challenge: string;
  /** The search space: the number is in 0..maxnumber. */
  readonly maxnumber: number;
  /** Random, with `?expires=<unix seconds>&purpose=<purpose>`. */
  readonly salt: string;
  /** Hex HMAC of the tenant and the challenge: the browser cannot forge a challenge. */
  readonly signature: string;
}

/** The refusal of a missing, malformed, expired, forged, wrong or reused answer. */
export interface CaptchaRejected {
  readonly code: 'captcha.invalid';
}
export const CAPTCHA_REJECTED: CaptchaRejected = Object.freeze({ code: 'captcha.invalid' });
export const CAPTCHA_REJECTED_STATUS: Readonly<Record<CaptchaRejected['code'], number>> =
  Object.freeze({ 'captcha.invalid': 400 });

/** How long a challenge may be solved and spent. */
export const CHALLENGE_TTL_SECONDS = 600;
/**
 * The work asked: a browser tries up to this many hashes (half on average), well under a
 * second on a phone, while a script pays it on every submission.
 */
export const DEFAULT_MAX_NUMBER = 100_000;
/** The largest encoded answer read; anything longer is refused unread. */
const MAX_PAYLOAD_LENGTH = 2048;
const PURPOSE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** The solved challenges in `platform.captcha_spent` (implemented in platform/persistence/). */
export interface CaptchaSpentStore {
  /** Records a spent challenge; false when it was already spent. */
  spend(tenant: TenantContext, challenge: string, expiresAt: Temporal.Instant): Promise<boolean>;
  prune(tenant: TenantContext, before: Temporal.Instant): Promise<number>;
}
export const CAPTCHA_SPENT_STORE = Symbol('CAPTCHA_SPENT_STORE');

/** Thrown by a store when a concurrent request spent the same challenge first. */
export class ChallengeSpentRaceError extends Error {
  override readonly name = 'ChallengeSpentRaceError';
  constructor() {
    super('A challenge was spent concurrently');
  }
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Issues and checks proof-of-work challenges. A challenge is bound to its tenant (in the
 * signature) and to a purpose (in the salt), expires after {@link CHALLENGE_TTL_SECONDS} and
 * counts once: `verify` spends it in its own unit of work, so call it before the use case's
 * unit, never inside one.
 */
export class CaptchaService {
  readonly #key: Buffer;

  constructor(
    secret: Buffer,
    private readonly unitOfWork: UnitOfWork,
    private readonly spent: CaptchaSpentStore,
    private readonly clock: Clock,
    private readonly maxNumber: number = DEFAULT_MAX_NUMBER,
  ) {
    this.#key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'phoenix:captcha:v1', 32));
  }

  issue(tenant: TenantContext, purpose: string): ProofOfWorkChallenge {
    if (!PURPOSE.test(purpose)) throw new TypeError(`Invalid captcha purpose "${purpose}"`);
    const expires = Math.floor(this.clock.now().epochMilliseconds / 1000) + CHALLENGE_TTL_SECONDS;
    const salt = `${randomBytes(12).toString('hex')}?expires=${expires}&purpose=${purpose}`;
    const challenge = sha256Hex(`${salt}${randomInt(0, this.maxNumber + 1)}`);
    return {
      algorithm: 'SHA-256',
      challenge,
      maxnumber: this.maxNumber,
      salt,
      signature: this.#sign(tenant, challenge),
    };
  }

  /** Checks the browser's answer (ALTCHA's base64 JSON payload) and spends it. */
  async verify(
    tenant: TenantContext,
    purpose: string,
    payload: string | undefined,
  ): Promise<Result<void, CaptchaRejected>> {
    const answer = this.#check(tenant, purpose, payload);
    if (answer === null) return err(CAPTCHA_REJECTED);
    try {
      const spent = await this.unitOfWork.run<boolean, never>(tenant, async () =>
        ok(await this.spent.spend(tenant, answer.challenge, answer.expiresAt)),
      );
      return spent.ok && spent.value ? ok(undefined) : err(CAPTCHA_REJECTED);
    } catch (error) {
      if (error instanceof ChallengeSpentRaceError) return err(CAPTCHA_REJECTED);
      throw error;
    }
  }

  #sign(tenant: TenantContext, challenge: string): string {
    return createHmac('sha256', this.#key).update(`${tenant.tenantId}\n${challenge}`).digest('hex');
  }

  #check(
    tenant: TenantContext,
    purpose: string,
    payload: string | undefined,
  ): { challenge: string; expiresAt: Temporal.Instant } | null {
    if (
      typeof payload !== 'string' ||
      payload.length === 0 ||
      payload.length > MAX_PAYLOAD_LENGTH
    ) {
      return null;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      return null;
    }
    if (!isRecord(decoded)) return null;
    const { algorithm, challenge, number, salt, signature } = decoded;
    if (
      algorithm !== 'SHA-256' ||
      typeof challenge !== 'string' ||
      !/^[0-9a-f]{64}$/.test(challenge) ||
      typeof signature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(signature) ||
      typeof salt !== 'string' ||
      salt.length > 256 ||
      typeof number !== 'number' ||
      !Number.isInteger(number) ||
      number < 0 ||
      number > this.maxNumber
    ) {
      return null;
    }
    const expected = Buffer.from(this.#sign(tenant, challenge), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null;
    const params = new URLSearchParams(salt.slice(salt.indexOf('?') + 1));
    if (salt.indexOf('?') < 0 || params.get('purpose') !== purpose) return null;
    const expires = Number(params.get('expires'));
    const now = this.clock.now().epochMilliseconds / 1000;
    if (!Number.isSafeInteger(expires) || expires <= now || expires > now + CHALLENGE_TTL_SECONDS) {
      return null;
    }
    if (sha256Hex(`${salt}${number}`) !== challenge) return null;
    return { challenge, expiresAt: Temporal.Instant.fromEpochMilliseconds(expires * 1000) };
  }
}

export const CAPTCHA_SERVICE = Symbol('CAPTCHA_SERVICE');
