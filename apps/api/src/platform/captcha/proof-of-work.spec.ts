import { createHash, randomBytes } from 'node:crypto';
import { ok, Temporal } from '@phoenix/shared-kernel';
import type { Result, TenantContext } from '@phoenix/shared-kernel';
import { FixedClock, testTenantContext } from '@phoenix/shared-kernel/testing';
import { TEST_TENANTS } from '../../../test/support/test-config';
import type { UnitOfWork } from '../unit-of-work/unit-of-work';
import {
  CaptchaService,
  CHALLENGE_TTL_SECONDS,
  type CaptchaSpentStore,
  type ProofOfWorkChallenge,
} from './proof-of-work';

// The self-hosted proof-of-work CAPTCHA (ALTCHA's wire format): a solved challenge passes once,
// in its tenant, for its purpose, before it expires; anything else is refused.

const unit = {
  run: <T, E>(_tenant: TenantContext, work: () => Promise<Result<T, E>>) => work(),
} as unknown as UnitOfWork;

class MemorySpent implements CaptchaSpentStore {
  readonly spent = new Set<string>();
  spend(tenant: TenantContext, challenge: string) {
    const key = `${tenant.tenantId}/${challenge}`;
    if (this.spent.has(key)) return Promise.resolve(false);
    this.spent.add(key);
    return Promise.resolve(true);
  }
  prune() {
    return Promise.resolve(0);
  }
}

/** What the browser does: tries numbers until the hash matches. */
function solve(challenge: ProofOfWorkChallenge): string {
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    const hash = createHash('sha256').update(`${challenge.salt}${number}`).digest('hex');
    if (hash === challenge.challenge) {
      return Buffer.from(JSON.stringify({ ...challenge, number })).toString('base64');
    }
  }
  throw new Error('unsolvable');
}

describe.each(TEST_TENANTS)('the proof-of-work CAPTCHA in tenant %s', (code) => {
  const tenant = testTenantContext(code);
  const other = testTenantContext(TEST_TENANTS.find((c) => c !== code)!);
  const secret = randomBytes(32);
  const build = (clock: FixedClock) =>
    new CaptchaService(secret, unit, new MemorySpent(), clock, 2_000);
  const rejected = { ok: false, error: { code: 'captcha.invalid' } };

  it('accepts a solved challenge once', async () => {
    const service = build(new FixedClock(Temporal.Instant.from('2026-10-27T20:00:00Z')));
    const payload = solve(service.issue(tenant, 'forms.submit'));
    await expect(service.verify(tenant, 'forms.submit', payload)).resolves.toEqual(ok(undefined));
    await expect(service.verify(tenant, 'forms.submit', payload)).resolves.toEqual(rejected);
  });

  it('refuses another tenant, another purpose, an expired or a forged challenge', async () => {
    const clock = new FixedClock(Temporal.Instant.from('2026-10-27T20:00:00Z'));
    const service = build(clock);
    const challenge = service.issue(tenant, 'forms.submit');
    const payload = solve(challenge);
    await expect(service.verify(other, 'forms.submit', payload)).resolves.toEqual(rejected);
    await expect(service.verify(tenant, 'forms.other', payload)).resolves.toEqual(rejected);
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64').toString()),
        signature: 'a'.repeat(64),
      }),
    ).toString('base64');
    await expect(service.verify(tenant, 'forms.submit', forged)).resolves.toEqual(rejected);
    clock.advance(Temporal.Duration.from({ seconds: CHALLENGE_TTL_SECONDS + 1 }));
    await expect(service.verify(tenant, 'forms.submit', payload)).resolves.toEqual(rejected);
  });

  it('refuses a missing, malformed or wrong answer', async () => {
    const service = build(new FixedClock(Temporal.Instant.from('2026-10-27T20:00:00Z')));
    const challenge = service.issue(tenant, 'forms.submit');
    const wrong = Buffer.from(JSON.stringify({ ...challenge, number: -1 })).toString('base64');
    for (const payload of [undefined, '', 'not base64 json', 'x'.repeat(5000), wrong]) {
      await expect(service.verify(tenant, 'forms.submit', payload)).resolves.toEqual(rejected);
    }
  });
});
