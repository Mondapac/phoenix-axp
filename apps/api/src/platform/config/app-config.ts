import path from 'node:path';
import { parseTenantId } from '@phoenix/shared-kernel';
import type { TenantId } from '@phoenix/shared-kernel';
import { z } from 'zod';

// apps/api/{src|dist}/platform/config -> repository root
const DEFAULT_TENANT_CONFIG_DIR = path.resolve(__dirname, '../../../../../config/tenants');

/** A tenant id as used in `tenant_id` columns (ADR-02), by the kernel's single rule. */
const tenantCode = z.string().transform((value, context) => {
  const tenantId = parseTenantId(value);
  if (tenantId.ok) return tenantId.value;
  context.addIssue('must be a tenant id: a lower-case letter, then 1 to 31 of a-z 0-9 -');
  return z.NEVER;
});

const httpUrl = z.string().regex(/^https?:\/\/[^\s/]+(\/\S*)?$/, 'must be an http(s):// URL');

const hostedTenants = z
  .string({ error: 'HOSTED_TENANTS is required; there is no default tenant (ADR-02)' })
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
  // Object storage (ADR-0012): all four of the first group, or none.
  S3_ENDPOINT: httpUrl.optional(),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be an S3 bucket name')
    .optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_ENDPOINT: httpUrl.optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
});

/** The variables that switch object storage on, together. */
const STORAGE_REQUIRED = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** The migration role's URL: read by the prisma CLI, the scripts and test setup only. */
export const MIGRATION_DATABASE_URL = 'MIGRATION_DATABASE_URL';

export interface AppConfig {
  /**
   * `api` serves HTTP; `worker` runs background work (none yet in Phase 0). Read by `main.ts`
   * only (and `platform/worker/`); a module never branches on it.
   */
  readonly appRole: AppRole;
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Tenants this deployment serves (ADR-02). Never empty, never defaulted. */
  readonly hostedTenants: readonly TenantId[];
  /** Serve Swagger UI at /docs. Off unless explicitly enabled (fails closed). */
  readonly apiDocsEnabled: boolean;
  /** Directories holding `<tenant-id>.json` tenant configuration (`TENANT_CONFIG_DIR`). */
  readonly tenantConfigDirs: readonly string[];
  /** PostgreSQL connection URL. Contains credentials: never log it. */
  readonly databaseUrl: string;
  /** The most pooled connections this process opens. `DATABASE_POOL_MAX`, 1 to 100, default 10. */
  readonly databasePoolMax: number;
  /**
   * The S3-compatible object store (SeaweedFS, ADR-0012), or `null` when `S3_*` is unset:
   * then every storage call fails. Required in production.
   */
  readonly storage: StorageConfig | null;
}

export interface StorageConfig {
  /** The URL the API reaches the store at. */
  readonly endpoint: string;
  /** The URL browsers reach the store at, for signed URLs; `endpoint` unless set. */
  readonly publicEndpoint: string;
  readonly region: string;
  /** One bucket per deployment; keys start with the tenant. */
  readonly bucket: string;
  readonly accessKeyId: string;
  /** A credential: never log it. */
  readonly secretAccessKey: string;
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
  if (parsed.success) issues.push(...storageIssues(env, parsed.data.NODE_ENV));
  if (!parsed.success || issues.length > 0) throw new InvalidConfigError(issues);
  const data = parsed.data;
  return Object.freeze({
    appRole: parsed.data.APP_ROLE,
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    hostedTenants: Object.freeze([...parsed.data.HOSTED_TENANTS]),
    apiDocsEnabled: parsed.data.API_DOCS_ENABLED === 'true',
    tenantConfigDirs: Object.freeze([path.resolve(parsed.data.TENANT_CONFIG_DIR)]),
    databaseUrl: parsed.data.DATABASE_URL,
    databasePoolMax: parsed.data.DATABASE_POOL_MAX,
    storage:
      data.S3_ENDPOINT && data.S3_BUCKET && data.S3_ACCESS_KEY_ID && data.S3_SECRET_ACCESS_KEY
        ? Object.freeze({
            endpoint: data.S3_ENDPOINT,
            publicEndpoint: data.S3_PUBLIC_ENDPOINT ?? data.S3_ENDPOINT,
            region: data.S3_REGION,
            bucket: data.S3_BUCKET,
            accessKeyId: data.S3_ACCESS_KEY_ID,
            secretAccessKey: data.S3_SECRET_ACCESS_KEY,
          })
        : null,
  });
}

/** All of STORAGE_REQUIRED or none of them; all of them in production. */
function storageIssues(env: Record<string, string | undefined>, nodeEnv: string): string[] {
  const missing = STORAGE_REQUIRED.filter((name) => !env[name]);
  if (missing.length === 0) return [];
  if (nodeEnv === 'production') {
    return missing.map((name) => `${name}: required in production (object storage, ADR-0012)`);
  }
  if (missing.length === STORAGE_REQUIRED.length) return [];
  const together = STORAGE_REQUIRED.join(', ');
  return missing.map((name) => `${name}: ${together} are set together (object storage, ADR-0012)`);
}
