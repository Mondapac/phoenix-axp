import { readPanelServerConfig, type PanelServerConfig } from './config';

// Two tenant fixtures with different hosts (CLAUDE.md rule 5): every behaviour is checked in both.
export const TENANT_HOSTS = [
  ['studio.fa.test', 'demo-fa'],
  ['studio.en.test:3001', 'demo-en'],
] as const;

export const config: PanelServerConfig = readPanelServerConfig(
  {
    PHOENIX_API_URL: 'http://api.internal:3000/',
    STUDIO_TENANT_HOSTS: TENANT_HOSTS.map(([host, tenant]) => `${host}=${tenant}`).join(','),
  },
  'STUDIO_TENANT_HOSTS',
);

/** A fetch that records each call and answers `answer`. */
export function recordingFetch(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

export function headersOf(init: RequestInit): Headers {
  return new Headers(init.headers);
}
