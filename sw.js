const SHELL_CACHE = 'cplayer5-shell-v17';
const COVER_CACHE = 'cplayer5-covers-v1';
const ACTIVE_CACHES = new Set([SHELL_CACHE, COVER_CACHE]);
const MAX_COVER_ENTRIES = 100;

const CORE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './playlist-downloader.html',
  './css/all.min.css',
  './css/app-shell.css',
  './css/anime-progress-thumb.css',
  './css/noto-sans-sc.css',
  './css/oneko-butterfly.css',
  './js/app-shell.js',
  './js/anime-progress-thumb.js',
  './js/tailwindcss.js',
  './js/color-thief.umd.js',
  './js/security.js',
  './js/http.js',
  './js/music-data.js',
  './js/music-download.js',
  './js/download-session.js',
  './js/oneko-butterfly.js',
  './img/icon.svg',
  './img/icon.png',
  './img/doraemon-progress-thumb.png',
  './img/oneko-tora.gif',
  './manifest.json'
];

function isNetEaseHost(hostname) {
  return hostname === 'music.126.net' || hostname.endsWith('.music.126.net');
}

function classifyRequest(request) {
  if (request.method !== 'GET') return 'ignore';

  const url = new URL(request.url);
  if (url.hostname === 'api.chksz.top') return 'api';

  const imagePath = /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url.pathname);
  if (isNetEaseHost(url.hostname) && (request.destination === 'image' || imagePath)) {
    return 'cover';
  }

  const audioPath = /\.(?:aac|flac|m4a|mp3|ogg|wav)(?:$|\?)/i.test(url.pathname);
  if (isNetEaseHost(url.hostname) || request.destination === 'audio' || audioPath) {
    return 'audio';
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    return 'navigate';
  }

  if (url.origin === self.location.origin) return 'asset';
  return 'ignore';
}

function cacheNamesToDelete(keys) {
  return keys.filter(key => key.startsWith('cplayer5-') && !ACTIVE_CACHES.has(key));
}

async function pruneCoverCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_COVER_ENTRIES;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map(key => cache.delete(key)));
}

async function coverCacheFirst(request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    await pruneCoverCache(cache);
  }
  return response;
}

async function navigationNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
  } catch (error) {
    console.warn('SW: navigation network request failed', error);
  }

  return (await caches.match(request))
    || (await caches.match('./index.html'))
    || caches.match('./offline.html');
}

async function updateShellAsset(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const update = updateShellAsset(request).catch(error => {
    console.warn('SW: asset update failed', error);
    return null;
  });

  if (cached) {
    event.waitUntil(update);
    return cached;
  }

  const response = await update;
  if (response) return response;
  return new Response('Offline', { status: 503 });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      await cache.addAll(CORE_ASSETS);
    } catch (error) {
      console.error('SW: shell installation failed', error);
      throw error;
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(cacheNamesToDelete(keys).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const policy = classifyRequest(event.request);

  if (policy === 'api' || policy === 'audio') {
    event.respondWith(fetch(event.request));
    return;
  }
  if (policy === 'cover') {
    event.respondWith(coverCacheFirst(event.request));
    return;
  }
  if (policy === 'navigate') {
    event.respondWith(navigationNetworkFirst(event.request));
    return;
  }
  if (policy === 'asset') {
    event.respondWith(staleWhileRevalidate(event.request, event));
  }
});
