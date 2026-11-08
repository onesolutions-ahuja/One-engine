import * as SecureStore from 'expo-secure-store';

export type Identity = { tenantId: string; userId: string };
export type MobileSession = {
  apiBase: string;
  accessToken: string;
  identity: Identity;
};

export type OfflineBriefcaseResponse = {
  tenantId: string;
  userId: string;
  syncedAt: string;
  selections: {
    objectApi: string;
    records: { recordId: string; record: Record<string, unknown> }[];
  }[];
};

const sessionStorageKey = 'metadrive.mobile.session.v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validIdentity(identity: Identity): boolean {
  return uuidPattern.test(identity.tenantId) && uuidPattern.test(identity.userId);
}

export class MobileApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'MobileApiError';
  }
}

export function normalizeApiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new MobileApiError('Enter a valid tenant API URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || (!__DEV__ && url.protocol !== 'https:')) {
    throw new MobileApiError('Use an HTTPS API URL without credentials, query parameters or fragments.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  const apiPath = path.endsWith('/api') ? path : `${path}/api`;
  return `${url.origin}${apiPath}`;
}

/** Only a tenant-owned API domain may provide a public, server-resolved display name. */
export async function resolveTenantDisplay(apiUrl:string,tenantSlug:string):Promise<string> {
  const base=normalizeApiBase(apiUrl);
  const origin=new URL(base).origin;
  const slug=tenantSlug.trim().toLowerCase();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new MobileApiError('Enter a valid tenant slug.');
  const response=await fetch(base+'/auth/tenant-display?tenantSlug='+encodeURIComponent(slug),{
    headers:{Origin:origin,Accept:'application/json'}
  });
  if(!response.ok)throw new MobileApiError('Tenant identity could not be verified on this API domain.');
  const result=await response.json() as {name?:unknown};
  if(typeof result.name!=='string'||!result.name.trim())
    throw new MobileApiError('Tenant identity is not available.');
  return result.name.trim().slice(0,120);
}

export async function loadStoredSession(): Promise<MobileSession | null> {
  const serialized = await SecureStore.getItemAsync(sessionStorageKey);
  if (!serialized) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new MobileApiError('The saved mobile session is invalid. Sign in again.');
  }
  if (!value || typeof value !== 'object') {
    throw new MobileApiError('The saved mobile session is invalid. Sign in again.');
  }
  const item = value as Record<string, unknown>;
  const identity = item.identity as Record<string, unknown> | null;
  if (typeof item.apiBase !== 'string' || typeof item.accessToken !== 'string'
    || !identity || typeof identity.tenantId !== 'string' || typeof identity.userId !== 'string'
    || !uuidPattern.test(identity.tenantId) || !uuidPattern.test(identity.userId)) {
    throw new MobileApiError('The saved mobile session is invalid. Sign in again.');
  }
  return { apiBase: normalizeApiBase(item.apiBase), accessToken: item.accessToken,
    identity: { tenantId: identity.tenantId, userId: identity.userId } };
}

export async function saveSession(session: MobileSession): Promise<void> {
  if (!validIdentity(session.identity)) {
    throw new MobileApiError('Cannot save a mobile session without a valid tenant and user identity.');
  }
  await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(session));
}

export async function deleteStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(sessionStorageKey);
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    throw new MobileApiError(`The API returned a non-JSON response (HTTP ${response.status}).`, response.status);
  }
  const payload = await response.json() as T & { error?: string; details?: unknown };
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? payload.details.map(String).join('; ')
      : typeof payload.details === 'string' ? payload.details : '';
    throw new MobileApiError(`${payload.error ?? `Request failed (${response.status})`}${details ? `: ${details}` : ''}`,
      response.status);
  }
  return payload;
}

async function publicRequest<T>(apiBase: string, path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-MetaDrive-Request-Source': 'mobile-app',
        ...init.headers
      }
    });
  } catch (error) {
    throw new MobileApiError(`Unable to reach the tenant API: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readJson<T>(response);
}

async function refreshAccessToken(session: MobileSession): Promise<void> {
  const refreshed = await publicRequest<{ access_token: string }>(session.apiBase, '/auth/refresh', {
    method: 'POST'
  });
  if (!refreshed.access_token) throw new MobileApiError('The API did not return an access token.');
  session.accessToken = refreshed.access_token;
  if (validIdentity(session.identity)) await saveSession(session);
}

export async function authenticatedRequest<T>(
  session: MobileSession,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const send = () => publicRequest<T>(session.apiBase, path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.accessToken}`
    }
  });
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.status !== 401) throw error;
    await refreshAccessToken(session);
    return send();
  }
}

function readIdentity(payload: unknown): Identity {
  if (!payload || typeof payload !== 'object' || !('user' in payload)
    || !payload.user || typeof payload.user !== 'object') {
    throw new MobileApiError('The API did not return a signed-in user identity.');
  }
  const user = payload.user as Record<string, unknown>;
  const tenantId = user.tenantId;
  const userId = user.userId ?? user.id;
  if (typeof tenantId !== 'string' || typeof userId !== 'string'
    || !validIdentity({ tenantId, userId })) {
    throw new MobileApiError('The API returned an invalid tenant or user identity.');
  }
  return { tenantId, userId };
}

export async function createAuthenticatedSession(apiBase: string, accessToken: string): Promise<MobileSession> {
  const session: MobileSession = { apiBase, accessToken, identity: { tenantId: '', userId: '' } };
  const metadata = await authenticatedRequest<unknown>(session, '/auth/me');
  session.identity = readIdentity(metadata);
  await saveSession(session);
  return session;
}

export async function signInWithPassword(input: {
  apiUrl: string;
  tenantSlug: string;
  email: string;
  password: string;
}): Promise<{ session?: MobileSession; challengeToken?: string; apiBase: string }> {
  const apiBase = normalizeApiBase(input.apiUrl);
  const payload = await publicRequest<{
    access_token?: string;
    challenge_token?: string;
    enrollment_required?: boolean;
  }>(
    apiBase,
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({
        tenantSlug: input.tenantSlug.trim(),
        email: input.email.trim(),
        password: input.password
      })
    }
  );
  if (payload.enrollment_required) {
    throw new MobileApiError('MFA enrollment is required. Complete MFA setup in the MetaDrive web app, then sign in again.');
  }
  if (payload.challenge_token) return { apiBase, challengeToken: payload.challenge_token };
  if (!payload.access_token) throw new MobileApiError('The API returned neither an access token nor an MFA challenge.');
  return { apiBase, session: await createAuthenticatedSession(apiBase, payload.access_token) };
}

export async function completeMfa(apiBase: string, challengeToken: string, code: string): Promise<MobileSession> {
  const payload = await publicRequest<{ access_token?: string }>(apiBase, '/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_token: challengeToken, code: code.trim() })
  });
  if (!payload.access_token) throw new MobileApiError('The API did not return an access token after MFA.');
  return createAuthenticatedSession(apiBase, payload.access_token);
}

export async function loadSessionMetadata(session: MobileSession): Promise<Identity> {
  const metadata = await authenticatedRequest<unknown>(session, '/auth/me');
  const identity = readIdentity(metadata);
  if (identity.tenantId !== session.identity.tenantId || identity.userId !== session.identity.userId) {
    throw new MobileApiError('The active API session identity changed. Sign out and sign in again.');
  }
  return identity;
}

export async function syncBriefcase(session: MobileSession): Promise<OfflineBriefcaseResponse> {
  const response = await authenticatedRequest<OfflineBriefcaseResponse>(session, '/tenant/offline-briefcase/data');
  if (response.tenantId !== session.identity.tenantId || response.userId !== session.identity.userId
    || !Array.isArray(response.selections)) {
    throw new MobileApiError('The API returned briefcase data for a different identity or invalid response.');
  }
  return response;
}

export async function signOutRemote(session: MobileSession): Promise<void> {
  await authenticatedRequest<void>(session, '/auth/logout', { method: 'POST' });
}
