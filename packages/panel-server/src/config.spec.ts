import { PanelConfigError, parseTenantHosts, readPanelServerConfig, tenantOfHost } from './config';
import { config, TENANT_HOSTS } from './test-support';

describe('the panel server configuration', () => {
  it.each(TENANT_HOSTS)('resolves host %s to tenant %s, ignoring case', (host, tenant) => {
    expect(tenantOfHost(config, host)).toBe(tenant);
    expect(tenantOfHost(config, host.toUpperCase())).toBe(tenant);
  });

  it('serves no tenant for an unknown host, a missing Host or another port', () => {
    expect(tenantOfHost(config, 'evil.test')).toBeNull();
    expect(tenantOfHost(config, null)).toBeNull();
    expect(tenantOfHost(config, 'studio.fa.test:8080')).toBeNull();
    expect(tenantOfHost(config, 'studio.en.test')).toBeNull();
  });

  it.each([
    [undefined, 'at least one host'],
    ['', 'at least one host'],
    ['studio.test', 'malformed'],
    ['studio.test=DEMO', 'malformed'],
    ['studio.test=demo-fa=x', 'malformed'],
    ['https://studio.test=demo-fa', 'malformed'],
    ['studio.test/x=demo-fa', 'malformed'],
    ['studio.test=demo-fa,STUDIO.test=demo-en', 'twice'],
    ['localhost:3001=demo-fa,localhost:3002=demo-en', 'different ports'],
  ])('refuses the host map %p (%s): there is no default tenant', (text, message) => {
    expect(() => parseTenantHosts(text, 'STUDIO_TENANT_HOSTS')).toThrow(PanelConfigError);
    expect(() => parseTenantHosts(text, 'STUDIO_TENANT_HOSTS')).toThrow(message);
  });

  it('lets several hosts serve one tenant', () => {
    const hosts = parseTenantHosts('a.test=demo-fa, b.test=demo-fa', 'X');
    expect([...hosts]).toEqual([
      ['a.test', 'demo-fa'],
      ['b.test', 'demo-fa'],
    ]);
  });

  it.each([
    undefined,
    'not a url',
    'ftp://api.internal/',
    'http://user:secret@api.internal/',
    'http://api.internal/?x=1',
    'http://api.internal/#x',
  ])('refuses the API URL %p', (url) => {
    expect(() =>
      readPanelServerConfig({ PHOENIX_API_URL: url, HOSTS: 'a.test=demo-fa' }, 'HOSTS'),
    ).toThrow(PanelConfigError);
  });

  it('keeps a base path of the API URL', () => {
    const read = readPanelServerConfig(
      { PHOENIX_API_URL: 'https://core.internal/api', HOSTS: 'a.test=demo-fa' },
      'HOSTS',
    );
    expect(read.apiUrl.href).toBe('https://core.internal/api/');
  });
});
