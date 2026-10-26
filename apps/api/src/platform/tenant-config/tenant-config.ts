import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTenantId } from '@phoenix/shared-kernel';
import type { TenantId } from '@phoenix/shared-kernel';
import { z } from 'zod';

/** A tenant's configuration file is missing, unreadable or invalid. Stops the boot. */
export class InvalidTenantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTenantConfigError';
  }
}

const SUPPORTED_CALENDARS: ReadonlySet<string> = new Set(Intl.supportedValuesOf('calendar'));

/** A BCP 47 tag in its canonical form (`en-GB`, never `en_gb`). */
const locale = z.string().refine((value) => {
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}, 'must be a canonical BCP 47 locale such as "en-GB"');

/** An IANA time zone the runtime knows (`Europe/London`); never an offset. */
const timeZone = z
  .string()
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/, 'must be an IANA zone such as "Europe/London"')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'is not a time zone this runtime knows');

const tenantSchema = z
  .strictObject({
    code: z.string(),
    displayName: z.string().min(1).max(100),
    defaultLocale: locale,
    supportedLocales: z.array(locale).min(1).max(20),
    timeZone,
    calendar: z
      .string()
      .refine((value) => SUPPORTED_CALENDARS.has(value), 'must be a calendar Intl supports'),
    direction: z.enum(['ltr', 'rtl']),
  })
  .refine(
    (tenant) => tenant.supportedLocales.includes(tenant.defaultLocale),
    'supportedLocales must include defaultLocale',
  )
  .refine(
    (tenant) => new Set(tenant.supportedLocales).size === tenant.supportedLocales.length,
    'supportedLocales has duplicates',
  );

/** One tenant's checked configuration (ADR-02). Frozen at boot. */
export interface TenantConfig {
  readonly code: TenantId;
  readonly displayName: string;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly timeZone: string;
  readonly calendar: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Reads `<tenant-id>.json` of every hosted tenant from the directories. A hosted tenant
 * without a file, a file that is not valid, a file whose `code` is not its name, and a tenant
 * configured twice each stop the boot. Files of tenants that are not hosted are not read.
 */
export function loadTenantConfigs(
  directories: readonly string[],
  hostedTenants: readonly TenantId[],
): ReadonlyMap<TenantId, TenantConfig> {
  const files = new Map<string, string>();
  for (const directory of directories) {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue;
      const code = path.basename(name, '.json');
      if (files.has(code)) {
        throw new InvalidTenantConfigError(`Tenant "${code}" is configured more than once`);
      }
      files.set(code, path.join(directory, name));
    }
  }

  const tenants = new Map<TenantId, TenantConfig>();
  for (const code of hostedTenants) {
    const file = files.get(code);
    if (file === undefined) {
      throw new InvalidTenantConfigError(
        `Hosted tenant "${code}" has no configuration file (${code}.json)`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new InvalidTenantConfigError(`${file} is not valid JSON`);
    }
    const parsed = tenantSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'tenant'}: ${issue.message}`)
        .join('; ');
      throw new InvalidTenantConfigError(`${file} is invalid: ${issues}`);
    }
    const declared = parseTenantId(parsed.data.code);
    if (!declared.ok || declared.value !== code) {
      throw new InvalidTenantConfigError(
        `${file} declares code "${parsed.data.code}"; it must match the file name`,
      );
    }
    tenants.set(
      code,
      Object.freeze({
        ...parsed.data,
        code: declared.value,
        supportedLocales: Object.freeze([...parsed.data.supportedLocales]),
      }),
    );
  }
  return tenants;
}
