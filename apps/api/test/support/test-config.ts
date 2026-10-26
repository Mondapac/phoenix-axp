import path from 'node:path';
import { parseTenantId, type TenantId } from '@phoenix/shared-kernel';
import { loadAppConfig, type AppConfig } from '../../src/platform/config/app-config';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** The checked-in tenant configuration, which holds both fixtures. */
export const TEST_TENANT_CONFIG_DIRS = [path.join(REPO_ROOT, 'config/tenants')] as const;

/**
 * Both tenant fixtures (ADR-02): the Persian/Jalali tenant in Asia/Tehran and the synthetic
 * English/Gregorian tenant in America/Toronto. A tenant-scoped test runs for both.
 */
export const TEST_TENANTS = ['demo-fa', 'demo-en'] as const;

/** A tenant id parsed with the kernel's rule; a malformed id is a mistake in the test. */
export function testTenantId(code: string): TenantId {
  const parsed = parseTenantId(code);
  if (!parsed.ok) throw new Error(`testTenantId: malformed tenant id "${code}"`);
  return parsed.value;
}

/** {@link TEST_TENANTS} as parsed tenant ids. */
export const TEST_TENANT_IDS: readonly TenantId[] = TEST_TENANTS.map(testTenantId);

/**
 * Application config for tests: both tenants hosted, the `api` role, logging quiet unless
 * overridden (`testAppConfig({ APP_ROLE: 'worker' })` for the worker role).
 */
export function testAppConfig(overrides: Record<string, string> = {}): AppConfig {
  return {
    ...loadAppConfig({
      NODE_ENV: 'test',
      APP_ROLE: 'api',
      HOSTED_TENANTS: TEST_TENANTS.join(','),
      // Never connected to unless a suite overrides it with a real database.
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      ...overrides,
    }),
    tenantConfigDirs: TEST_TENANT_CONFIG_DIRS,
  };
}
