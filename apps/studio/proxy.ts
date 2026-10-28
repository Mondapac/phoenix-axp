import {
  contentSecurityPolicy,
  newNonce,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  tenantOfHost,
} from '@phoenix/panel-server';
import { NextResponse, type NextRequest } from 'next/server';
import { studioConfig } from './app/_server/panel';

// Every studio request: a host the studio does not serve answers 404 before any page or route
// (ADR-0002, no default tenant); every answer gets a fresh nonce CSP and the security headers.
export function proxy(request: NextRequest): NextResponse {
  if (tenantOfHost(studioConfig(), request.headers.get('host')) === null) {
    return new NextResponse(null, { status: 404, headers: SECURITY_HEADERS });
  }
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('content-security-policy', policy);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('strict-transport-security', STRICT_TRANSPORT_SECURITY);
  }
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|favicon.ico).*)' }],
};
