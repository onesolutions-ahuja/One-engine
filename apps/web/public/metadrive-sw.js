/* Universal MetaDrive shell. Never cache API responses, tenant metadata, credentials or private assets. */
const CACHE = 'metadrive-shell-v2';
const SCOPE = new URL(self.registration.scope);
const sameScope = (url) => url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
const isPublicAsset = (url) => sameScope(url) && (
  /\.(?:js|css|woff2?|png|svg|ico|webp)$/.test(url.pathname)
);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(SCOPE.href)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('metadrive-shell-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_APP_ASSETS' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.slice(0, 200).filter(value => {
    if (typeof value !== 'string') return false;
    try { return isPublicAsset(new URL(value, SCOPE.href)); } catch { return false; }
  });
  event.waitUntil(caches.open(CACHE).then(async cache => {
    for (const url of urls) {
      try { await cache.add(url); } catch { /* Next online visit can retry. */ }
    }
  }));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!sameScope(url) || url.pathname.includes('/api/') || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(SCOPE.href, copy));
      }
      return response;
    }).catch(async () => (await caches.match(SCOPE.href)) || Response.error()));
  } else if (isPublicAsset(url)) {
    // Network-first prevents an outdated builder bundle surviving a new release.
    event.respondWith(fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
  }
});
