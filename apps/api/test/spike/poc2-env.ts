// SPIKE (PoC 2): environment of the application under test. Imported first by the spec, before
// AppModule reads IDENTITY_SPIKE.
process.env.IDENTITY_SPIKE = 'on';
process.env.KEYCLOAK_URL ??= 'http://127.0.0.1:8181';
process.env.CORE_PUBLIC_URL ??= 'http://127.0.0.1:3190';
process.env.KEYCLOAK_STUDIO_CLIENT_SECRET ??= 'studio-client-secret-poc2';
process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ??= 'core-admin-secret-poc2';

export const CORE = process.env.CORE_PUBLIC_URL;
export const KEYCLOAK = process.env.KEYCLOAK_URL;
export const POC2_APP_URL = 'postgresql://phoenix_api:phoenix_api@127.0.0.1:5433/phoenix_poc2';
export const POC2_OWNER_URL =
  'postgresql://phoenix_migrator:phoenix_migrator@127.0.0.1:5433/phoenix_poc2';
