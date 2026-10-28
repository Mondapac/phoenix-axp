// The panels' response headers (ADR-0004; frontend rules: CSP with a nonce). The CSP allows
// the panel's own origin only: scripts carry the request's nonce, there is no inline script
// without it, no plugin, no framing and no form posted elsewhere. Development adds what the
// Next.js dev server needs (eval for fast refresh, its websocket).

/** A fresh nonce for one response: 16 random bytes, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The Content-Security-Policy of one response with `nonce`. */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // The dev server injects style tags without a nonce (a nonce would void 'unsafe-inline').
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Positioned popups (Base UI) set style attributes; attributes cannot run code.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Headers every panel response carries, besides the CSP. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

/** HSTS for production answers (the panels are served over https only there). */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';
