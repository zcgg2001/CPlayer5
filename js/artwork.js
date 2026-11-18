import { normalizeMediaUrl } from './security.js';
import { coverUrl } from './runtime-policy.js';
import { artworkIdentity, sameArtworkRelease } from './music-catalog.js?v=2';
export { sameArtworkRelease };
import { imageURL, qqAlbumMid } from './library-data.js';
import { requestJson } from './http.js?v=37';

const text = value => typeof value === 'string' ? value.trim() : '';
const key = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const albumName = song => text(song?.albumEntity?.name || song?.album || song?.name);
const base = () => globalThis.location?.href || 'https://cplayer.invalid/';
const qqAlbumCover = mid => /^[a-zA-Z0-9]{14}$/.test(mid || '') ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : '';
const boundedSet = (cache, id, value) => {
  cache.delete(id); cache.set(id, value);
  while (cache.size > 200) cache.delete(cache.keys().next().value);
};

export function artworkUrl(value, size = 640, baseUrl = base()) {
  let safe = normalizeMediaUrl(value, { allowDataImage: true, baseUrl });
  if (!safe) return '';
  if (/^(data:|blob:)/.test(safe)) return safe;
  let url = new URL(safe);
  const origin = new URL(baseUrl).origin;
  // Resize the upstream URL before wrapping it; never append sizing to a signed URL.
  if (url.origin === origin && url.pathname === '/api/cover') {
    safe = normalizeMediaUrl(url.searchParams.get('url'), { baseUrl });
    if (!safe) return '';
    url = new URL(safe);
  }
  if (/\/img\/icon\.(png|svg)$/.test(url.pathname)) return '';
  const width = Math.max(80, Math.min(1200, Math.round(Number(size) || 640)));
  if (url.hostname.endsWith('.music.126.net') && [...url.searchParams.keys()].every(k => k === 'param')) {
    if (size === 0) url.searchParams.delete('param');
    else url.searchParams.set('param', `${width}y${width}`);
  } else if (size !== 0 && url.hostname === 'y.gtimg.cn' && !url.search && /\/T002R\d+x\d+M000/.test(url.pathname)) {
    const qqSize = width <= 150 ? 150 : width <= 300 ? 300 : 800;
    url.pathname = url.pathname.replace(/T002R\d+x\d+M000/, `T002R${qqSize}x${qqSize}M000`);
  } else if (size > 0 && width <= 320 && url.hostname.endsWith('.hdslb.com') && !url.search && /\.(jpe?g|png)$/i.test(url.pathname)) {
    url.pathname += '@480w_270h_1c.webp';
  }
  return coverUrl(url.href, origin);
}

function artworkSources(song) {
  // Playback may switch providers. Keep the selected recording's album art in that case.
  if (song?.artworkSource?.provider && song.artworkSource.provider !== song.provider) song = song.artworkSource;
  const values = [song?.cover, song?.albumEntity?.cover];
  for (const variant of [...(song?.albumEntity?.artwork || [])].reverse()) values.push(variant.url);
  for (const source of song?.sources || []) if (sameArtworkRelease(song, source)) values.push(source.cover);
  // QQ exposes an album mid; it is not interchangeable with a numeric album ID.
  values.push(qqAlbumCover(qqAlbumMid(song)));
  return values.filter(Boolean);
}

export function fallbackArtwork(song = {}) {
  // Stable per album/artist, so every track in an album shares the same visual identity.
  const seed = `${key(albumName(song))}|${key(song.artist)}`;
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  const colors = [hue, (hue + 36) % 360, (hue + 310) % 360, (hue + 18) % 360].map(h => {
    const channel = n => { const k = (n + h / 30) % 12; return Math.round(255 * (.78 - .0836 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return `rgb(${channel(0)}, ${channel(8)}, ${channel(4)})`;
  });
  // Only numeric colors enter the SVG; no upstream text/markup is interpolated.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 38% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 42% 14%)"/></linearGradient><radialGradient id="l"><stop stop-color="#fff" stop-opacity=".17"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><path fill="url(#g)" d="M0 0h640v640H0z"/><circle cx="130" cy="80" r="500" fill="url(#l)"/><g fill="none" stroke="#fff" stroke-opacity=".13"><circle cx="320" cy="320" r="216"/><circle cx="320" cy="320" r="202"/><circle cx="320" cy="320" r="174"/><circle cx="320" cy="320" r="160"/></g><circle cx="320" cy="320" r="102" fill="#fff" fill-opacity=".09"/><g fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M298 349V276l68-14v73M298 294l68-14"/><ellipse cx="282" cy="350" rx="16" ry="12"/><ellipse cx="350" cy="336" rx="16" ry="12"/></g></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, colors, status: 'fallback' };
}

export function loadArtworkImage(url, { signal, timeoutMs = 3500, ImageClass = globalThis.Image } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const image = new ImageClass();
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); image.onload = image.onerror = null;
      signal?.removeEventListener('abort', abort);
      if (error) { image.removeAttribute('src'); reject(error); } else resolve(url);
    };
    const abort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Artwork timed out')), timeoutMs);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(image.naturalWidth > 0 ? null : new Error('Empty image'));
    image.onerror = () => finish(new Error('Artwork unavailable'));
    signal?.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}

// Include the original CDN resource when a particular thumbnail rendition is missing.
export function artworkCandidates(song, size = 640, baseUrl = base()) {
  return imageVariants(artworkSources(song), size, baseUrl);
}

function imageVariants(sources, size, baseUrl) {
  return [...new Set(sources.flatMap(source => [artworkUrl(source, size, baseUrl), artworkUrl(source, 0, baseUrl)]).filter(Boolean))];
}

// Persist only verified public cover references, never image bytes, credentials or playback URLs.
const COVER_INDEX = 'cp_verified_track_covers_v1';
function publicCover(value, baseUrl) {
  if (typeof value !== 'string' || !value) return '';
  let url;
  try { url = new URL(value, baseUrl); } catch { return ''; }
  if (url.origin === new URL(baseUrl).origin) {
    if (url.pathname === '/api/v1/music/cover') return imageURL(url.pathname + url.search);
    if (url.pathname === '/api/cover') return publicCdnCover(url.searchParams.get('url'));
  }
  return publicCdnCover(url.href);
}
function publicCdnCover(value) {
  const safe = imageURL(value);
  if (!safe.startsWith('https://')) return '';
  const url = new URL(safe);
  if (url.port || url.hash) return '';
  if (url.hostname.endsWith('.music.126.net') && [...url.searchParams.keys()].every(k => k === 'param')) {
    url.searchParams.delete('param'); return url.href;
  }
  return url.hostname === 'y.gtimg.cn' && !url.search && /^\/music\/photo_new\/T002R\d+x\d+M000[A-Za-z0-9]{14}\.jpg$/.test(url.pathname) ? url.href : '';
}

// A canceled view can stop waiting without aborting another view's shared lookup.
async function waitForMetadata(pending, signal) {
  signal.throwIfAborted();
  let abort;
  const canceled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([pending, canceled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export function createArtworkResolver({ fetchImpl = globalThis.fetch, loadImage = loadArtworkImage, now = Date.now, baseUrl = base(), timeoutMs = 12000, storage } = {}) {
  const failures = new Map(), metadata = new Map(), successes = new Map(), pendingMetadata = new Map();
  const knownCovers = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(COVER_INDEX) || '[]');
    for (const [id, url] of saved.slice(-200)) {
      const cover = publicCover(url, baseUrl);
      if (cover && /^(?:qq:[A-Za-z0-9]{14}|netease:\d{1,20})$/.test(id)) knownCovers.set(id, cover);
    }
  } catch { /* Older installations and private browsing can start with an empty index. */ }

  function remember(id, url) {
    const cover = publicCover(url, baseUrl);
    if (!id || !cover || knownCovers.get(id) === cover) return;
    boundedSet(knownCovers, id, cover);
    try { storage?.setItem(COVER_INDEX, JSON.stringify([...knownCovers])); } catch { /* Memory cache is still valid. */ }
  }

  async function nativeCover(id) {
    const cached = metadata.get(id);
    if (cached?.expires > now()) return cached.url;
    if (pendingMetadata.has(id)) return pendingMetadata.get(id);
    const [platform, nativeId] = id.split(':');
    const bundledQQ = platform === 'qq' && globalThis.CPlayerNative && new URL(baseUrl).pathname.startsWith('/android-player/');
    const path = bundledQQ ? `/android-player/qq-artwork/${nativeId}`
      : `/api/v1/music/metadata?${new URLSearchParams({ source: platform, id: nativeId, artwork: '1' })}`;
    // Each waiter owns its image and cancellation. One disappearing row must not cancel a shared lookup.
    const pending = (async () => {
      let url = '', ttl = 300000;
      try {
        const result = await requestJson(path, { fetchImpl, timeoutMs: 5500 });
        if (result?.code !== 200 || String(result.data?.id) !== nativeId) throw new Error('Mismatched artwork');
        url = platform === 'qq' ? qqAlbumCover(result.data.albumMid) : result.data.cover || result.data.albumEntity?.cover || '';
      } catch (error) { if (error.status !== 404) ttl = 30000; }
      boundedSet(metadata, id, { url, expires: now() + ttl });
      return url;
    })().finally(() => pendingMetadata.delete(id));
    pendingMetadata.set(id, pending);
    return pending;
  }

  function identity(song) {
    const original = song.artworkSource || song;
    if (original.type && original.type !== 'song') return '';
    return artworkIdentity(original) || (original.sources || []).filter(other => sameArtworkRelease(song, other)).map(artworkIdentity).find(Boolean) || '';
  }

  return {
    knownCover(song) { return knownCovers.get(identity(song)) || ''; },
    async resolve(song, { signal, size = 640 } = {}) {
      signal?.throwIfAborted();
      const scope = new AbortController();
      const abort = () => scope.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => scope.abort(new DOMException('Artwork deadline', 'TimeoutError')), timeoutMs);
      const id = identity(song);
      const sources = artworkSources(song);
      const cacheId = JSON.stringify([id || sources, size]);
      const tried = new Set();
      const attempt = async url => {
        if (!url || tried.has(url) || tried.size >= 5 || failures.get(url) > now()) return null;
        scope.signal.throwIfAborted(); tried.add(url);
        try {
          await loadImage(url, { signal: scope.signal }); scope.signal.throwIfAborted();
        } catch (error) {
          if (scope.signal.aborted) throw error;
          boundedSet(failures, url, now() + 30000); return null;
        }
        boundedSet(successes, cacheId, { url, expires: now() + 86400000 });
        remember(id, url);
        return { url, status: 'ready' };
      };
      try {
        const saved = successes.get(cacheId);
        const known = knownCovers.get(id);
        const candidates = imageVariants(known ? [known, ...sources] : sources, size, baseUrl);
        if (saved?.expires > now()) candidates.unshift(saved.url);
        for (const url of [...new Set(candidates)].slice(0, id ? 3 : 5)) {
          const result = await attempt(url); if (result) return result;
        }
        if (id) {
          scope.signal.throwIfAborted();
          const source = await waitForMetadata(nativeCover(id), scope.signal);
          for (const url of imageVariants(source ? [source] : [], size, baseUrl)) {
            const result = await attempt(url); if (result) return result;
          }
        }
      } catch (error) { if (signal?.aborted) throw error; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      return fallbackArtwork(song);
    },
  };
}

let localStore;
try { localStore = globalThis.localStorage; } catch { /* Storage is optional. */ }
export const artworkResolver = createArtworkResolver({ storage: localStore });

// One observer covers dynamic and virtualized lists. Dropped rows never take a network slot.
const bindings = new WeakMap(), watching = new Set(), visible = new Set();
let observer, active = 0;
function drainArtwork() {
  for (const image of visible) {
    if (active >= 4) break;
    if (image.closest?.('[inert]')) continue;
    visible.delete(image); watching.delete(image); observer?.unobserve(image);
    const load = bindings.get(image);
    if (!load || image.isConnected === false) continue;
    active++;
    void load().finally(() => { active--; drainArtwork(); });
  }
}
function watchArtwork(image) {
  if (!globalThis.IntersectionObserver) { visible.add(image); queueMicrotask(drainArtwork); return; }
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      for (const {target, isIntersecting} of entries) {
        if (!watching.has(target)) continue;
        if (isIntersecting) visible.add(target); else visible.delete(target);
      }
      drainArtwork();
    });
    new MutationObserver(records => {
      if (!watching.size) return;
      if (records.some(record => record.removedNodes.length)) {
        for (const target of watching) if (!target.isConnected) {
          observer.unobserve(target); watching.delete(target); visible.delete(target);
        }
      }
      if (records.some(record => record.attributeName === 'inert')) drainArtwork();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  }
  watching.add(image); observer.observe(image);
}

export function bindArtwork(image, song, { size = 320, url = song?.cover, resolver = artworkResolver } = {}) {
  const track = url === song?.cover ? song : { ...song, cover: url };
  const fallback = fallbackArtwork(track);
  image.classList.add('cplayer-artwork'); image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
  image.removeAttribute('crossorigin'); image.onload = image.onerror = null;
  image.dataset.artworkState = 'loading'; image.style.backgroundImage = `url("${fallback.url}")`;
  image.src = fallback.url;
  async function load() {
    const result = await resolver.resolve(track, { size }).catch(() => fallback);
    if (bindings.get(image) !== load || image.isConnected === false) return;
    image.dataset.artworkState = result.status;
    if (result.status !== 'ready') return;
    image.onerror = () => {
      image.onerror = null; image.dataset.artworkState = 'fallback'; image.src = fallback.url;
    };
    image.src = result.url;
  }
  bindings.set(image, load); watchArtwork(image);
  return image;
}

// One presentation transaction for all playback surfaces; stale requests cannot repaint.
export function createArtworkPresenter({ resolver = createArtworkResolver(), images, onChange = () => {} }) {
  let controller, version = 0;
  const paint = (result, song) => {
    for (const image of images().filter(Boolean)) {
      image.classList.add('cplayer-artwork'); image.referrerPolicy = 'no-referrer';
      image.removeAttribute('crossorigin');
      image.dataset.artworkState = result.status;
      image.alt = result.status === 'ready' ? `${albumName(song) || '歌曲'}封面` : '音乐封面占位图';
      image.onload = null;
      image.onerror = result.status === 'ready' ? () => paint(fallbackArtwork(song), song) : null;
      image.src = result.url;
    }
    onChange(result, song);
  };
  return {
    reset(song = {}) {
      controller?.abort(); version++; paint(fallbackArtwork(song), song);
    },
    async show(song, { signal, isCurrent = () => true } = {}) {
      controller?.abort(); controller = new AbortController();
      const current = controller, token = ++version;
      const abort = () => current.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const live = () => !signal?.aborted && !current.signal.aborted && token === version && isCurrent();
      if (!live()) { signal?.removeEventListener('abort', abort); return; }
      paint(fallbackArtwork(song), song);
      try {
        const result = await resolver.resolve(song, { signal: current.signal });
        if (live()) paint(result, song);
        return result;
      } catch { /* Cancellation leaves the new selection in control. */ }
      finally { signal?.removeEventListener('abort', abort); }
    },
  };
}
