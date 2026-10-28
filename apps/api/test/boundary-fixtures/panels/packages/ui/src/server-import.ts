// Violation: panel-server-is-server-only (packages/ui is client code).
import { tenantOfHost } from '@phoenix/panel-server';

export const leaked = tenantOfHost;
