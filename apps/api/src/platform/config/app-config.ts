import { randomBytes } from 'node:crypto';
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

const httpUrl = z.string().regex(/^https?:\/\/[^\s/]+(\/\S*)?$/, 'must be an http(s):// URL');

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
  // The interface the API listens on; every interface unless set (security review S2-3).
  HOST: z
    .string()
    .regex(/^[A-Za-z0-9.:-]+$/, 'must be a host name or an IP address')
    .optional(),
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
  // Sessions (ADR-0004 decision 2): the key of the CSRF tokens and of the sign-in flows.
  SESSION_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43,}$/, 'must be at least 32 random bytes, base64url')
    .optional(),
  PANEL_ORIGINS: z.string().optional(),
  STAFF_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  // Keycloak (ADR-0004 decision 1): the URL, the studio client's secret and its callback URL
  // together, or none.
  KEYCLOAK_URL: httpUrl.optional(),
  KEYCLOAK_REALM_TEMPLATE: z
    .string()
    .regex(/^[A-Za-z0-9_-]*\{tenant\}[A-Za-z0-9_-]*$/, 'must be a realm name containing {tenant}')
    .default('phoenix-{tenant}'),
  KEYCLOAK_STUDIO_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,64}$/)
    .default('phoenix-studio'),
  KEYCLOAK_STUDIO_CLIENT_SECRET: z.string().min(1).optional(),
  STUDIO_SIGN_IN_CALLBACK_URL: httpUrl.optional(),
  KEYCLOAK_DIRECTORY_CLAIM: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,64}$/)
    .default('ldap_id'),
  KEYCLOAK_ADMIN_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,64}$/)
    .default('phoenix-core-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
  // Flowable (ADR-0005; ADR-0020 decision 6): its REST base URL and the core's credential,
  // together, or none.
  FLOWABLE_URL: httpUrl.optional(),
  FLOWABLE_USER: z.string().min(1).optional(),
  FLOWABLE_PASSWORD: z.string().min(1).optional(),
});

/** The variables that switch object storage on, together. */
const STORAGE_REQUIRED = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** The variables that switch Keycloak sign-in on, together. */
const KEYCLOAK_REQUIRED = [
  'KEYCLOAK_URL',
  'KEYCLOAK_STUDIO_CLIENT_SECRET',
  'STUDIO_SIGN_IN_CALLBACK_URL',
] as const;

/** The variables that switch the process engine on, together. */
const FLOWABLE_REQUIRED = ['FLOWABLE_URL', 'FLOWABLE_USER', 'FLOWABLE_PASSWORD'] as const;

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
  /**
   * The interface the API listens on (`HOST`), or null for every interface. A deployment sets
   * it so that only the BFFs reach the API: they set `x-tenant-id` (security review S2-3).
   */
  readonly host: string | null;
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
  /**
   * The S3-compatible object store (SeaweedFS, ADR-0012), or `null` when `S3_*` is unset:
   * then every storage call fails. Required in production.
   */
  readonly storage: StorageConfig | null;
  /** Sessions of every population (ADR-0004 decision 2). */
  readonly session: SessionConfig;
  /**
   * Staff sign-in through Keycloak, or `null` when `KEYCLOAK_*` is unset: then every sign-in
   * answers `sign-in.unavailable`. Required in production.
   */
  readonly keycloak: KeycloakConfig | null;
  /**
   * The process engine (Flowable REST, ADR-0005), or `null` when `FLOWABLE_*` is unset: then
   * every engine call fails as unavailable and process commands wait. Required in production.
   */
  readonly flowable: FlowableConfig | null;
}

export interface FlowableConfig {
  /** The REST base URL, without a trailing slash: reachable from the core's network only. */
  readonly url: string;
  readonly user: string;
  /** A credential: never log it. */
  readonly password: string;
}

export interface SessionConfig {
  /**
   * The key of the CSRF tokens and of the sign-in flows (`SESSION_SECRET`). A credential: never
   * log it. Outside production, when unset, a random key per process.
   */
  readonly secret: Buffer;
  /**
   * The origins of the panels (`PANEL_ORIGINS`): a state-changing request with a session must
   * carry one of them in `Origin`. Empty refuses every such request.
   */
  readonly panelOrigins: readonly string[];
  /** How long a staff session lives, in hours (`STAFF_SESSION_HOURS`, 1 to 24, default 8). */
  readonly staffSessionHours: number;
}

export interface KeycloakConfig {
  /** Keycloak's base URL, without a trailing slash. */
  readonly url: string;
  /**
   * The realm of a tenant: `{tenant}` is replaced by the tenant id. One realm per tenant (owner
   * decision P2, ADR-0022); `phoenix-{tenant}` unless set.
   */
  readonly realmTemplate: string;
  readonly studioClientId: string;
  /** A credential: never log it. */
  readonly studioClientSecret: string;
  /** The redirect URI registered on the studio client: the studio BFF's callback route. */
  readonly studioCallbackUrl: string;
  /**
   * The ID-token claim that marks a directory (LDAP/AD) user: a Keycloak user-attribute mapper
   * of `LDAP_ID`. A user without it is a local user (ADR-0019 decision 3).
   */
  readonly directoryClaim: string;
  /**
   * The service-account client the directory sync reads users with (realm-management
   * `view-users`). The secret is a credential; null leaves the sync unavailable.
   */
  readonly adminClientId: string;
  readonly adminClientSecret: string | null;
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
  if (parsed.success) {
    issues.push(...storageIssues(env, parsed.data.NODE_ENV));
    issues.push(...sessionIssues(env, parsed.data.NODE_ENV));
    issues.push(...flowableIssues(env, parsed.data.NODE_ENV));
  }
  if (!parsed.success || issues.length > 0) throw new InvalidConfigError(issues);
  const data = parsed.data;
  return Object.freeze({
    appRole: parsed.data.APP_ROLE,
    nodeEnv: parsed.data.NODE_ENV,
    nodeEnvExplicit: env.NODE_ENV !== undefined,
    port: parsed.data.PORT,
    host: parsed.data.HOST ?? null,
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
    session: Object.freeze({
      secret:
        data.SESSION_SECRET === undefined
          ? randomBytes(32)
          : Buffer.from(data.SESSION_SECRET, 'base64url'),
      panelOrigins: Object.freeze(originsOf(data.PANEL_ORIGINS)),
      staffSessionHours: data.STAFF_SESSION_HOURS,
    }),
    keycloak:
      data.KEYCLOAK_URL && data.KEYCLOAK_STUDIO_CLIENT_SECRET && data.STUDIO_SIGN_IN_CALLBACK_URL
        ? Object.freeze({
            url: data.KEYCLOAK_URL.replace(/\/+$/, ''),
            realmTemplate: data.KEYCLOAK_REALM_TEMPLATE,
            studioClientId: data.KEYCLOAK_STUDIO_CLIENT_ID,
            studioClientSecret: data.KEYCLOAK_STUDIO_CLIENT_SECRET,
            studioCallbackUrl: data.STUDIO_SIGN_IN_CALLBACK_URL,
            directoryClaim: data.KEYCLOAK_DIRECTORY_CLAIM,
            adminClientId: data.KEYCLOAK_ADMIN_CLIENT_ID,
            adminClientSecret: data.KEYCLOAK_ADMIN_CLIENT_SECRET ?? null,
          })
        : null,
    flowable:
      data.FLOWABLE_URL && data.FLOWABLE_USER && data.FLOWABLE_PASSWORD
        ? Object.freeze({
            url: data.FLOWABLE_URL.replace(/\/+$/, ''),
            user: data.FLOWABLE_USER,
            password: data.FLOWABLE_PASSWORD,
          })
        : null,
  });
}

/** `PANEL_ORIGINS` as a list: comma-separated, trimmed, empty entries dropped. */
function originsOf(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;

/**
 * Keycloak's variables all or none, all in production, with the directory sync's admin client
 * secret; a session secret in production; panel
 * origins that are origins (scheme, host, port), https in production.
 */
function sessionIssues(env: Record<string, string | undefined>, nodeEnv: string): string[] {
  const production = nodeEnv === 'production';
  const issues: string[] = [];
  if (production && !env.SESSION_SECRET) {
    issues.push('SESSION_SECRET: required in production (sessions, ADR-0004)');
  }
  for (const origin of originsOf(env.PANEL_ORIGINS)) {
    if (!ORIGIN.test(origin) || (production && !origin.startsWith('https://'))) {
      issues.push(`PANEL_ORIGINS: "${origin}" must be an origin${production ? ' over https' : ''}`);
    }
  }
  // Without the admin client a directory disable never reaches the core (ADR-0022 decision 6).
  // Client secrets and the admin bearer token travel to Keycloak: never in clear text.
  if (production && env.KEYCLOAK_URL && !env.KEYCLOAK_URL.startsWith('https://')) {
    issues.push('KEYCLOAK_URL: must be https in production (client secrets, ADR-0004)');
  }
  if (production && !env.KEYCLOAK_ADMIN_CLIENT_SECRET) {
    issues.push('KEYCLOAK_ADMIN_CLIENT_SECRET: required in production (directory sync, ADR-0022)');
  }
  const missing = KEYCLOAK_REQUIRED.filter((name) => !env[name]);
  if (missing.length === 0 || (missing.length === KEYCLOAK_REQUIRED.length && !production)) {
    return issues;
  }
  const reason = production
    ? 'required in production (staff sign-in, ADR-0004)'
    : `${KEYCLOAK_REQUIRED.join(', ')} are set together (staff sign-in, ADR-0004)`;
  return [...issues, ...missing.map((name) => `${name}: ${reason}`)];
}

/** All of FLOWABLE_REQUIRED or none of them; all of them in production. */
function flowableIssues(env: Record<string, string | undefined>, nodeEnv: string): string[] {
  const missing = FLOWABLE_REQUIRED.filter((name) => !env[name]);
  if (missing.length === 0) return [];
  if (nodeEnv === 'production') {
    return missing.map((name) => `${name}: required in production (process engine, ADR-0005)`);
  }
  if (missing.length === FLOWABLE_REQUIRED.length) return [];
  const together = FLOWABLE_REQUIRED.join(', ');
  return missing.map((name) => `${name}: ${together} are set together (process engine, ADR-0005)`);
}

/** All of STORAGE_REQUIRED or none of them; all of them in production. */
function storageIssues(env: Record<string, string | undefined>, nodeEnv: string): string[] {
  const missing = STORAGE_REQUIRED.filter((name) => !env[name]);
  if (missing.length === 0) return nodeEnv === 'production' ? productionStorageIssues(env) : [];
  if (nodeEnv === 'production') {
    return missing.map((name) => `${name}: required in production (object storage, ADR-0012)`);
  }
  if (missing.length === STORAGE_REQUIRED.length) return [];
  const together = STORAGE_REQUIRED.join(', ');
  return missing.map((name) => `${name}: ${together} are set together (object storage, ADR-0012)`);
}

/** The local development key of infra/seaweedfs/s3.json: never a production credential. */
const DEVELOPMENT_SECRET = 'phoenix-dev-secret';

/** Production serves signed URLs over https only, and never with the development key. */
function productionStorageIssues(env: Record<string, string | undefined>): string[] {
  const issues: string[] = [];
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT ?? '';
  if (!publicEndpoint.startsWith('https://')) {
    issues.push(
      `${env.S3_PUBLIC_ENDPOINT ? 'S3_PUBLIC_ENDPOINT' : 'S3_ENDPOINT'}: signed URLs need ` +
        'https in production (set S3_PUBLIC_ENDPOINT to the https URL browsers use)',
    );
  }
  if (env.S3_SECRET_ACCESS_KEY === DEVELOPMENT_SECRET) {
    issues.push('S3_SECRET_ACCESS_KEY: the local development key is refused in production');
  }
  return issues;
}
