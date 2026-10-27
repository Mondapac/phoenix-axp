import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Temporal } from '@phoenix/shared-kernel';
import {
  TEST_TENANT_CONFIG_DIRS,
  TEST_TENANT_IDS,
  testTenantId,
} from '../../../test/support/test-config';
import { InvalidTenantConfigError, loadTenantConfigs } from './tenant-config';
import { TenantNotHostedError, TenantRegistry } from './tenant-registry';

const VALID = {
  code: 'acme',
  displayName: 'Acme',
  defaultLocale: 'en-GB',
  supportedLocales: ['en-GB'],
  timeZone: 'Europe/London',
  calendar: 'gregory',
  direction: 'ltr',
};

function directoryWith(files: Record<string, unknown>): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'tenants-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      path.join(directory, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return directory;
}

describe('the checked-in tenant fixtures', () => {
  const tenants = loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANT_IDS);

  it('load for both tenants, frozen', () => {
    expect([...tenants.keys()]).toEqual(TEST_TENANT_IDS);
    for (const tenant of tenants.values()) {
      expect(Object.isFrozen(tenant)).toBe(true);
      expect(Object.isFrozen(tenant.supportedLocales)).toBe(true);
    }
  });

  it('differ in every dimension a tenant-scoped test must cover', () => {
    const [persian, english] = TEST_TENANT_IDS.map((id) => tenants.get(id)!);
    expect(persian!.calendar).not.toBe(english!.calendar);
    expect(persian!.timeZone).not.toBe(english!.timeZone);
    expect(persian!.direction).not.toBe(english!.direction);
    expect(persian!.defaultLocale.slice(0, 2)).not.toBe(english!.defaultLocale.slice(0, 2));
  });

  it("read one instant as each tenant's local date in its own calendar and zone", () => {
    const instant = Temporal.Instant.from('2026-03-20T21:00:00Z');
    const local = TEST_TENANT_IDS.map((id) => {
      const tenant = tenants.get(id)!;
      const date = instant.toZonedDateTimeISO(tenant.timeZone).withCalendar(tenant.calendar);
      return [date.year, date.month, date.day];
    });
    // 00:30 on Nowruz 1405 in Tehran; still 17:00 on 20 March 2026 in Toronto.
    expect(local).toEqual([
      [1405, 1, 1],
      [2026, 3, 20],
    ]);
  });
});

describe('loadTenantConfigs', () => {
  const acme = [testTenantId('acme')];

  it('loads a valid file', () => {
    expect(loadTenantConfigs([directoryWith({ 'acme.json': VALID })], acme).get(acme[0]!)).toEqual(
      VALID,
    );
  });

  it('refuses a hosted tenant without a file', () => {
    expect(() => loadTenantConfigs([directoryWith({})], acme)).toThrow(
      'Hosted tenant "acme" has no configuration file',
    );
  });

  it('refuses a file whose code is not its name, and a tenant configured twice', () => {
    expect(() =>
      loadTenantConfigs([directoryWith({ 'acme.json': { ...VALID, code: 'other' } })], acme),
    ).toThrow('it must match the file name');
    const one = directoryWith({ 'acme.json': VALID });
    expect(() => loadTenantConfigs([one, one], acme)).toThrow('configured more than once');
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown field', { ...VALID, currency: 'GBP' }],
    ['a non-canonical locale', { ...VALID, defaultLocale: 'en_gb', supportedLocales: ['en_gb'] }],
    ['a default locale it does not support', { ...VALID, supportedLocales: ['fr-FR'] }],
    ['duplicated locales', { ...VALID, supportedLocales: ['en-GB', 'en-GB'] }],
    ['an offset for a zone', { ...VALID, timeZone: '+03:30' }],
    ['an unknown zone', { ...VALID, timeZone: 'Mars/Olympus_Mons' }],
    ['an unknown calendar', { ...VALID, calendar: 'jalali' }],
    ['an unknown direction', { ...VALID, direction: 'ttb' }],
  ])('refuses %s', (_case, content) => {
    expect(() => loadTenantConfigs([directoryWith({ 'acme.json': content })], acme)).toThrow(
      InvalidTenantConfigError,
    );
  });

  it('reads no file of a tenant that is not hosted', () => {
    const directory = directoryWith({ 'acme.json': VALID, 'broken.json': '{' });
    expect([...loadTenantConfigs([directory], acme).keys()]).toEqual(acme);
  });
});

describe('TenantRegistry', () => {
  const registry = new TenantRegistry(loadTenantConfigs(TEST_TENANT_CONFIG_DIRS, TEST_TENANT_IDS));

  it.each(TEST_TENANT_IDS)('hosts %s', (id) => {
    expect(registry.isHosted(id)).toBe(true);
    expect(registry.get(id).code).toBe(id);
  });

  it('hosts nothing else and never substitutes a tenant', () => {
    const other = testTenantId('not-hosted');
    expect(registry.isHosted(other)).toBe(false);
    expect(() => registry.get(other)).toThrow(TenantNotHostedError);
    expect(registry.hostedTenantIds()).toEqual(TEST_TENANT_IDS);
  });
});
