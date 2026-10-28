'use client';
// Violation: client-reads-no-env.
export const api = process.env.PHOENIX_API_URL;
