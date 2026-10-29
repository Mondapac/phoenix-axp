// The browser's half of the API's proof-of-work CAPTCHA (platform/captcha, ALTCHA's wire
// format): find the number whose SHA-256 with the salt is the challenge, and answer the
// challenge with it, base64 JSON. Web Crypto only; nothing leaves the browser but the answer.

export interface ProofOfWorkChallenge {
  readonly algorithm: 'SHA-256';
  readonly challenge: string;
  readonly maxnumber: number;
  readonly salt: string;
  readonly signature: string;
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The answer to `challenge`, or null when no number in its range matches. */
export async function solveChallenge(
  challenge: ProofOfWorkChallenge,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string | null> {
  if (challenge.algorithm !== 'SHA-256') return null;
  const encoder = new TextEncoder();
  const target = challenge.challenge.toLowerCase();
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    const digest = await subtle.digest('SHA-256', encoder.encode(`${challenge.salt}${number}`));
    if (hex(digest) === target) {
      const json = JSON.stringify({ ...challenge, number });
      return btoa(String.fromCharCode(...encoder.encode(json)));
    }
  }
  return null;
}
