'use client';
// Violation: client-reads-no-env, in a JavaScript module (the check scans .js and .jsx too).
export const secret = process.env.STUDIO_TENANT_HOSTS;
