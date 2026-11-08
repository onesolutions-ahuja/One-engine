/**
 * Recovery for versioned Vite chunks replaced by a GitHub Pages deployment.
 * No app-specific logic and no reload loop: at most one automatic retry per
 * URL/version window, preserving the deep link, query and hash.
 */
const RETRY_PARAMETER = '_md_chunk_reload';
const RETRY_WINDOW_MS = 2 * 60 * 1000;
const STORAGE_KEY = 'metadrive:missing-chunk-retry:v1';

export function isMissingDynamicChunk(error: unknown): boolean {
  const message = typeof error === 'string' ? error
    : error instanceof Error ? error.message : '';
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .+ failed|failed to fetch.*\.(?:js|css)(?:\?|\b)|unable to preload css|expected a javascript(?: module)?(?:-type)? script.*mime type|strict mime type checking is enforced for module scripts/i.test(message);
}

export function canAutoRecoverChunk(url: string, now: number, priorRetry = ''): boolean {
  const destination = new URL(url);
  const marker = Number(destination.searchParams.get(RETRY_PARAMETER));
  if (Number.isFinite(marker) && marker > 0 && now >= marker && now - marker < RETRY_WINDOW_MS) return false;
  if (priorRetry) {
    const [path, timestamp] = priorRetry.split('|');
    const previous = Number(timestamp);
    if (path === destination.pathname && Number.isFinite(previous)
      && now >= previous && now - previous < RETRY_WINDOW_MS) return false;
  }
  return true;
}

function latestVersionUrl(): string {
  const destination = new URL(window.location.href);
  destination.searchParams.set(RETRY_PARAMETER, String(Date.now()));
  return destination.toString();
}

/** Returns true only if a one-time navigation was initiated. */
export function recoverMissingDynamicChunk(error: unknown): boolean {
  if (!isMissingDynamicChunk(error)) return false;
  const now = Date.now();
  let previous = '';
  try { previous = window.sessionStorage.getItem(STORAGE_KEY) ?? ''; } catch { /* blocked storage */ }
  if (!canAutoRecoverChunk(window.location.href, now, previous)) return false;
  try { window.sessionStorage.setItem(STORAGE_KEY, window.location.pathname + '|' + now); }
  catch { /* the query marker alone also prevents reload loops */ }
  window.location.replace(latestVersionUrl());
  return true;
}

/** Explicit retry remains possible when a deployment was still publishing. */
export function reloadLatestWorkspace(): void {
  window.location.replace(latestVersionUrl());
}
