// SPIKE (PoC 2): a scripted browser: a cookie jar per host (like a browser, ports share
// cookies), manual redirects, and Keycloak's login form. The x-tenant-id header stands in for
// the BFF, which derives it from the panel's host. Test-only.
import { CORE } from './poc2-env';

export interface Page {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly json: unknown;
}

export class Browser {
  readonly #jar = new Map<string, Map<string, string>>();

  constructor(readonly tenantId: string) {}

  cookie(name: string): string | undefined {
    return this.#jar.get(new URL(CORE).hostname)?.get(name);
  }

  setCookie(name: string, value: string): void {
    const host = new URL(CORE).hostname;
    if (!this.#jar.has(host)) this.#jar.set(host, new Map());
    this.#jar.get(host)!.set(name, value);
  }

  async request(
    url: string,
    init: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      tenant?: string;
    } = {},
  ): Promise<Response> {
    const target = new URL(url);
    const cookies = this.#jar.get(target.hostname) ?? new Map<string, string>();
    const headers: Record<string, string> = { ...init.headers };
    if (cookies.size > 0) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (url.startsWith(CORE)) headers['x-tenant-id'] = init.tenant ?? this.tenantId;
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers,
      redirect: 'manual',
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const separator = pair!.indexOf('=');
      const name = pair!.slice(0, separator).trim();
      const value = pair!.slice(separator + 1).trim();
      const expired = attributes.some(
        (a) => /^\s*max-age=0/i.test(a) || /^\s*expires=thu, 01 jan 1970/i.test(a),
      );
      if (!this.#jar.has(target.hostname)) this.#jar.set(target.hostname, new Map());
      if (expired || value === '') this.#jar.get(target.hostname)!.delete(name);
      else this.#jar.get(target.hostname)!.set(name, value);
    }
    return response;
  }

  async follow(
    url: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Page> {
    let response = await this.request(url, init);
    let current = url;
    for (let hops = 0; response.status >= 300 && response.status < 400 && hops < 10; hops += 1) {
      current = new URL(response.headers.get('location')!, current).toString();
      response = await this.request(current);
    }
    const body = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(body) as unknown;
    } catch {
      json = null;
    }
    return { status: response.status, url: current, body, json };
  }

  /** The whole sign-in: core -> Keycloak login form -> credentials -> core callback. */
  async signIn(username: string, password: string): Promise<Page> {
    const login = await this.follow(`${CORE}/spike/auth/sign-in`);
    const action = /action="([^"]*login-actions\/authenticate[^"]*)"/.exec(login.body)?.[1];
    if (action === undefined) return login;
    return this.follow(action.replaceAll('&amp;', '&'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password, credentialId: '' }).toString(),
    });
  }

  async get(path: string, tenant?: string): Promise<number> {
    const response = await this.request(`${CORE}${path}`, { tenant });
    await response.arrayBuffer();
    return response.status;
  }

  async post(path: string): Promise<{ status: number; json: unknown }> {
    const response = await this.request(`${CORE}${path}`, { method: 'POST' });
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null };
  }
}
