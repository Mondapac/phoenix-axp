import { createHash } from 'node:crypto';
import { solveChallenge, type ProofOfWorkChallenge } from './proof-of-work';

// The browser's solver against challenges built the way platform/captcha builds them.

function challengeFor(number: number, maxnumber = 1_000): ProofOfWorkChallenge {
  const salt = 'c0ffee?expires=1793000000&purpose=identity.portal-code';
  return {
    algorithm: 'SHA-256',
    challenge: createHash('sha256').update(`${salt}${number}`).digest('hex'),
    maxnumber,
    salt,
    signature: 'a'.repeat(64),
  };
}

describe('solveChallenge', () => {
  it('answers base64 JSON of the challenge and the number found', async () => {
    const challenge = challengeFor(437);
    const answer = await solveChallenge(challenge);
    expect(answer).not.toBeNull();
    expect(JSON.parse(Buffer.from(answer!, 'base64').toString('utf8'))).toEqual({
      ...challenge,
      number: 437,
    });
  });

  it('answers null when no number in the range matches', async () => {
    await expect(solveChallenge(challengeFor(50, 10))).resolves.toBeNull();
  });
});
