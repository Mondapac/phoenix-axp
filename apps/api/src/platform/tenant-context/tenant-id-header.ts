/**
 * The request header that names the tenant of an HTTP request (ADR-0002). The tier in front of
 * the API (gateway or BFF) sets it from the host name and overwrites any value the client
 * sent.
 */
export const TENANT_ID_HEADER = 'x-tenant-id';
