import { URL } from 'node:url';

export type StalwartJmapSession = {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  capabilities?: Record<string, unknown>;
  accounts?: Record<string, unknown>;
};

export type StalwartJmapResponse = {
  methodResponses?: Array<[string, Record<string, unknown>, string]>;
  sessionState?: string;
  createdIds?: Record<string, string>;
  notCreated?: Record<string, unknown>;
  notUpdated?: Record<string, unknown>;
  notDestroyed?: Record<string, unknown>;
};

export class StalwartJmapError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'StalwartJmapError';
  }
}

/**
 * Small server-only JMAP transport for Stalwart 0.16+.
 * Supply the base URL and API key from server configuration; never from a browser request.
 * This class intentionally exposes generic JMAP calls only. Domain/account operations must
 * use the schema-supported x: methods and be wrapped by tenant/RBAC-aware application services.
 */
export class StalwartJmapClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 8_000,
  ) {
    this.baseUrl = new URL(baseUrl);
    if (!['https:', 'http:'].includes(this.baseUrl.protocol)) {
      throw new StalwartJmapError('Stalwart URL must use HTTP or HTTPS');
    }
    if (this.baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(this.baseUrl.hostname)) {
      throw new StalwartJmapError('Stalwart HTTP is permitted only for loopback connections');
    }
    if (!this.apiKey.trim()) throw new StalwartJmapError('Stalwart API key is not configured');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new StalwartJmapError('Invalid Stalwart request timeout');
    }
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/$/, '');
  }

  private async request(url: URL, init: RequestInit = {}, allowSessionRedirect = false): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      redirect: 'manual',
    });
    if (allowSessionRedirect && response.status === 307) {
      const location = response.headers.get('location');
      if (location) {
        let target: URL;
        try {
          target = new URL(location, url);
        } catch {
          throw new StalwartJmapError('Stalwart advertised an invalid JMAP redirect', response.status);
        }
        if (target.origin === this.baseUrl.origin
          && !target.username && !target.password
          && target.pathname === '/jmap/session'
          && !target.search && !target.hash) {
          return this.request(target, init);
        }
      }
    }
    if (!response.ok) {
      // Do not include response bodies: provider errors can contain sensitive details.
      throw new StalwartJmapError(`Stalwart request failed with HTTP ${response.status}`, response.status);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new StalwartJmapError('Stalwart returned an invalid JSON response', response.status);
    }
  }

  async discoverSession(): Promise<StalwartJmapSession> {
    const discoveryUrl = new URL('.well-known/jmap', this.baseUrl.href.replace(/\/$/, '') + '/');
    const value = await this.request(discoveryUrl, {}, true);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new StalwartJmapError('Stalwart JMAP session response is invalid');
    }
    const session = value as Partial<StalwartJmapSession>;
    if (typeof session.apiUrl !== 'string' || !session.apiUrl) {
      throw new StalwartJmapError('Stalwart JMAP session has no apiUrl');
    }
    // Stalwart may advertise its public hostname even when MetaDrive uses its
    // private loopback listener. Never send the management key to an advertised
    // host; pin requests to the explicitly configured Stalwart origin.
    const advertised = new URL(session.apiUrl, discoveryUrl);
    if (!['https:', 'http:'].includes(advertised.protocol)
      || advertised.username || advertised.password
      || !['/jmap', '/jmap/'].includes(advertised.pathname)
      || advertised.search || advertised.hash) {
      throw new StalwartJmapError('Stalwart advertised an unsupported JMAP endpoint');
    }
    const apiUrl = new URL('/jmap', this.baseUrl);
    return { ...session, apiUrl: apiUrl.href };
  }

  async call(
    session: StalwartJmapSession,
    methodName: string,
    args: Record<string, unknown>,
    callId = 'metadrive-1',
  ): Promise<StalwartJmapResponse> {
    if (!/^[A-Za-z][A-Za-z0-9:./_-]{0,127}$/.test(methodName)) {
      throw new StalwartJmapError('Invalid JMAP method name');
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(callId)) {
      throw new StalwartJmapError('Invalid JMAP call id');
    }
    const value = await this.request(new URL(session.apiUrl), {
      method: 'POST',
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
        methodCalls: [[methodName, args, callId]],
      }),
    });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new StalwartJmapError('Stalwart JMAP response is invalid');
    }
    const result = value as StalwartJmapResponse;
    const first = result.methodResponses?.[0];
    if (!first || first[2] !== callId) {
      throw new StalwartJmapError('Stalwart JMAP response did not match the request');
    }
    if (first[0] === 'error') {
      const type = typeof first[1]?.type === 'string' ? first[1].type : 'unknown';
      throw new StalwartJmapError(`Stalwart rejected the JMAP method (${type})`);
    }
    return result;
  }
}
