import { contentSecurityPolicy, newNonce, SECURITY_HEADERS } from './security-headers';

describe('the panel security headers', () => {
  it('draws a fresh 128-bit nonce per response', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  });

  it('allows only nonce scripts, no framing, plugins or foreign form targets', () => {
    const policy = contentSecurityPolicy('abc', false);
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-abc'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('adds only what the dev server needs in development', () => {
    const policy = contentSecurityPolicy('abc', true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('forbids framing and sniffing on every response', () => {
    expect(SECURITY_HEADERS['x-frame-options']).toBe('DENY');
    expect(SECURITY_HEADERS['x-content-type-options']).toBe('nosniff');
    expect(SECURITY_HEADERS['referrer-policy']).toBe('no-referrer');
  });
});
