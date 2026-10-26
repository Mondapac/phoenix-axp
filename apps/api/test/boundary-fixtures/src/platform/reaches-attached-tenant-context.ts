import { attached } from './tenant-context/attached-tenant-context';

// Violation: only the tenant guard and the @Tenant() decorator file reach the request map.
export const violation = attached;
