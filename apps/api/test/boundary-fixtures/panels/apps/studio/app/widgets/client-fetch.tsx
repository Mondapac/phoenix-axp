'use client';
// Violation: browser-calls-own-origin (twice). Allowed: the BFF's own relative route.
export async function load() {
  await fetch('http://api.internal:3000/identity/staff/me');
  await fetch('//api.internal/tenancy/sites');
  return fetch('/api/identity/staff/me');
}
