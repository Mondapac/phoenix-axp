import path from 'node:path';
import { parseTenantId } from '@phoenix/shared-kernel';
import type { TenantId } from '@phoenix/shared-kernel';
import { z } from 'zod';

// apps/api/{src|dist}/platform/config -> repository root
const DEFAULT_TENANT_CONFIG_DIR = path.resolve(__dirname, '../../../../../config/tenants');

/** A tenant id as used in `tenant_id` columns (ADR-0002), by the kernel's single rule. */
const tenantCode = z.string().transform((value, context) => {
  const tenantId = parseTenantId(value);
  if (tenantId.ok) return tenantId.value;
  context.addIssue('must be a tenant id: a lower-case letter, then 1 to 31 of a-z 0-9 -');
  return z.NEVER;
});

const hostedTenants = z
  .string({ error: 'HOSTED_TENANTS is required; there is no default tenant (ADR-0002)' })
  .transform((value) =>
    value
      .split(',')
      .map((code) => code.trim())
      .filter((code) => code.length > 0),
  )
  .pipe(z.array(tenantCode).min(1, 'HOSTED_TENANTS must list at least one tenant'))
  .refine((codes) => new Set(codes).size === codes.length, 'HOSTED_TENANTS has duplicates');

/** The two process roles (ported from Mondapac's platform persistence design 8). */
export const APP_ROLES = ['api', 'worker'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const envSchema = z.object({
  // Required, no default: a worker that silently started as `api` would run no jobs.
  APP_ROLE: z.enum(APP_ROLES, {
    error: 'APP_ROLE is required and must be "api" or "worker"; there is no default',
  }),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOSTED_TENANTS: hostedTenants,
  API_DOCS_ENABLED: z.enum(['true', 'false']).default('false'),
  TENANT_CONFIG_DIR: z.string().min(1).default(DEFAULT_TENANT_CONFIG_DIR),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(/^postgres(ql)?:\/\/\S+$/, 'must be a postgresql:// connection URL'),
  // An explicit pool maximum per process, 10 unless set.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

/** The migration role's URL: read by the prisma CLI, the scripts and test setup only. */
export const MIGRATION_DATABASE_URL = 'MIGRATION_DATABASE_URL';

export interface AppConfig {
  /**
   * `api` serves HTTP; `worker` runs background work (none yet in Phase 0). Read by `main.ts`
   * only (and `platform/worker/`); a module never branches on it.
   */
  readonly appRole: AppRole;
  readonly nodeEnv: 'development' | 'test' | 'production';
  /**
   * Whether `NODE_ENV` was set at all. An unset `NODE_ENV` reads as `development` for logging,
   * but counts as a production start for the placeholder check (Phoenix ADR-0010 decision 4).
   */
  readonly nodeEnvExplicit: boolean;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Tenants this deployment serves (ADR-0002). Never empty, never defaulted. */
  readonly hostedTenants: readonly TenantId[];
  /** Serve Swagger UI at /docs. Off unless explicitly enabled (fails closed). */
  readonly apiDocsEnabled: boolean;
  /** Directories holding `<tenant-id>.json` tenant configuration (`TENANT_CONFIG_DIR`). */
  readonly tenantConfigDirs: readonly string[];
  /** PostgreSQL connection URL. Contains credentials: never log it. */
  readonly databaseUrl: string;
  /** The most pooled connections this process opens. `DATABASE_POOL_MAX`, 1 to 100, default 10. */
  readonly databasePoolMax: number;
}

export class InvalidConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Validates the process environment once at startup. The application refuses to start
 * on invalid configuration instead of failing later on first use.
 */
export function loadAppConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
  if (MIGRATION_DATABASE_URL in env) {
    issues.push(
      `${MIGRATION_DATABASE_URL}: must not be set for the application; it is for ` +
        'pnpm db:*, pnpm test:db and pnpm verify only',
    );
  }
  if (!parsed.success || issues.length > 0) throw new InvalidConfigError(issues);
  return Object.freeze({
    appRole: parsed.data.APP_ROLE,
    nodeEnv: parsed.data.NODE_ENV,
    nodeEnvExplicit: env.NODE_ENV !== undefined,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    hostedTenants: Object.freeze([...parsed.data.HOSTED_TENANTS]),
    apiDocsEnabled: parsed.data.API_DOCS_ENABLED === 'true',
    tenantConfigDirs: Object.freeze([path.resolve(parsed.data.TENANT_CONFIG_DIR)]),
    databaseUrl: parsed.data.DATABASE_URL,
    databasePoolMax: parsed.data.DATABASE_POOL_MAX,
  });
}
