const VERSION = "ygo-collect-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const IMAGE_CACHE = `${VERSION}-images`;
const SHELL_FILES = ["./", "./ygocollect.html", "./data/tcg.json", "./data/ae.json", "./data/ocg.json", "./data/banlists.json"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => ![SHELL_CACHE, DATA_CACHE, IMAGE_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.hostname === "images.ygoprodeck.com") {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate" || /\.(html?|css|js)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request, SHELL_CACHE));
    return;
  }

  if (/\.json$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request, DATA_CACHE));
  }
});
