const SHELL_CACHE = 'cplayer5-shell-v25';
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
  './css/charts.css',
  './css/music-explore.css',
  './css/anime-progress-thumb.css',
  './css/art-direction.css',
  './css/noto-sans-sc.css',
  './css/oneko-butterfly.css',
  './js/app-shell.js',
  './js/lucide.min.js',
  './js/lucide-bridge.js',
  './js/charts-page.js',
  './js/music-explore.js',
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
  './img/favicon.svg',
  './img/doraemon-progress-thumb.png',
  './img/oneko-tora.gif',
  './manifest.json'
];

function isNetEaseHost(hostname) {
  return hostname === 'music.126.net' || hostname.endsWith('.music.126.net');
}

function isArtworkHost(hostname) {
  return isNetEaseHost(hostname)
    || hostname === 'hdslb.com'
    || hostname.endsWith('.hdslb.com');
}

function classifyRequest(request) {
  if (request.method !== 'GET') return 'ignore';

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return 'api';
  if (['api.chksz.top', 'api.chksz.com', 'api.bilibili.com'].includes(url.hostname)) return 'api';

  const imagePath = /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url.pathname);
  if (isArtworkHost(url.hostname) && (request.destination === 'image' || imagePath)) {
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
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) return response;
  } catch (error) {
    console.warn('SW: navigation network request failed', error);
  }

  return (await caches.match(request))
    || (await caches.match('./index.html'))
    || caches.match('./offline.html');
}

async function shellAssetNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
  } catch (error) {
    console.warn('SW: shell asset network request failed', error);
  }

  return (await cache.match(request, { ignoreSearch: true }))
    || new Response('Offline', { status: 503 });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const freshAssets = CORE_ASSETS.map(asset => new Request(
      new URL(asset, self.location.href),
      { cache: 'reload' },
    ));
    try {
      await cache.addAll(freshAssets);
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
    event.respondWith(shellAssetNetworkFirst(event.request));
  }
});
