/**
 * One installable MetaDrive shell for every licensed metadata-driven app.
 * Business records and tenant metadata are deliberately not cached by this service worker.
 */
export function registerUniversalShell(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    const scope = import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(scope + 'metadrive-sw.js', { scope })
      .then(async () => {
        const ready = await navigator.serviceWorker.ready;
        const assets = performance.getEntriesByType('resource').map(entry => entry.name)
          .filter(url => /\\.(?:js|css|woff2?|png|svg|ico|webp)(?:\\?|$)/.test(url));
        ready.active?.postMessage({ type: 'CACHE_APP_ASSETS', urls: assets });
      }).catch((error: unknown) => console.warn('MetaDrive offline shell unavailable', error));
  }, { once: true });
}
