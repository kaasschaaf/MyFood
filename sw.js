// Service worker for Kost. Bump CACHE_VERSION when the precache list or the
// caching strategy changes, so old caches are cleaned up on activate.
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'kost-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const FONT_CACHE = `${CACHE_PREFIX}fonts-${CACHE_VERSION}`;

// All paths are resolved against the service worker's scope, so the app keeps
// working from a GitHub Pages subpath (for example /MyFood/).
const PRECACHE_URLS = [
  './index.html',
  './producten.html',
  './manifest.json',
  './css/tailwind.css',
  './css/style.css',
  './js/runtime-config.js',
  './js/pwa.js',
  './js/app.js',
  './js/ah-service.js',
  './js/browser-cache.js',
  './js/content-translator.js',
  './js/gemini-service.js',
  './js/i18n.js',
  './js/product-comparison.js',
  './js/recipes-service.js',
  './js/ui-components.js',
  './js/utils.js',
  './data/recipes.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const OFFLINE_URL = new URL('./index.html', self.location).href;
const PRECACHE_REQUESTS = PRECACHE_URLS.map(path => new URL(path, self.location).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_REQUESTS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE && key !== FONT_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function cacheResponse(cacheName, request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return;
  // Clone synchronously: the page starts consuming the original body as soon as
  // the response is handed back to it.
  const copy = response.clone();
  caches.open(cacheName)
    .then(cache => cache.put(request, copy))
    .catch(() => {
      // Quota or private-mode failures must never break the page load.
    });
}

function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    cacheResponse(STATIC_CACHE, request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineResponse();
  }
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    cacheResponse(STATIC_CACHE, request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (await caches.match(OFFLINE_URL)) || offlineResponse();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(response => {
      cacheResponse(FONT_CACHE, request, response);
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await network) || offlineResponse();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(handleNavigation(request));
    } else {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
