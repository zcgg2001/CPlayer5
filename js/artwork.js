import { normalizeMediaUrl } from './security.js';
import { coverUrl } from './runtime-policy.js';
import { neteaseMetadataId, versionOf } from './music-catalog.js?v=2';
import { requestJson } from './http.js?v=37';

const text = value => typeof value === 'string' ? value.trim() : '';
const key = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const albumName = song => text(song?.albumEntity?.name || song?.album || song?.name);
const base = () => globalThis.location?.href || 'https://cplayer.invalid/';
const boundedSet = (cache, id, value) => {
  cache.delete(id); cache.set(id, value);
  while (cache.size > 200) cache.delete(cache.keys().next().value);
};

// Album identity matters: an ISRC alone can refer to several different releases.
export function sameArtworkRelease(song, other) {
  const album = key(song?.albumEntity?.name || song?.album);
  return Boolean(album && album === key(other?.albumEntity?.name || other?.album)
    && key(song.artist) && key(song.artist) === key(other.artist)
    && key(song.name) === key(other.name)
    && versionOf(song.name, song.versionLabel).descriptor === versionOf(other.name, other.versionLabel).descriptor);
}

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
    url.searchParams.set('param', `${width}y${width}`);
  } else if (url.hostname === 'y.gtimg.cn' && !url.search && /\/T002R\d+x\d+M000/.test(url.pathname)) {
    const qqSize = width <= 150 ? 150 : width <= 300 ? 300 : 800;
    url.pathname = url.pathname.replace(/T002R\d+x\d+M000/, `T002R${qqSize}x${qqSize}M000`);
  }
  return coverUrl(url.href, origin);
}

export function artworkCandidates(song, size = 640, baseUrl = base()) {
  const values = [song?.cover, song?.albumEntity?.cover];
  for (const variant of [...(song?.albumEntity?.artwork || [])].reverse()) values.push(variant.url);
  for (const source of song?.sources || []) if (sameArtworkRelease(song, source)) values.push(source.cover);
  // QQ exposes an album mid; it is not interchangeable with a numeric album ID.
  const mid = song?.albumEntity?.mid || song?.albummid || song?.albumMid;
  if (/^[a-zA-Z0-9]{14}$/.test(mid || '')) values.push(`https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`);
  return [...new Set(values.map(value => artworkUrl(value, size, baseUrl)).filter(Boolean))].slice(0, 4);
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

export function createArtworkResolver({ fetchImpl = globalThis.fetch, loadImage = loadArtworkImage, now = Date.now, baseUrl = base(), timeoutMs = 12000 } = {}) {
  const failures = new Map(), metadata = new Map(), successes = new Map();
  return {
    async resolve(song, { signal, size = 640 } = {}) {
      signal?.throwIfAborted();
      const fallback = fallbackArtwork(song);
      const scope = new AbortController();
      const abort = () => scope.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => scope.abort(new DOMException('Artwork deadline', 'TimeoutError')), timeoutMs);
      const original = song.artworkSource || song;
      // Don't borrow a native ID from a loosely grouped source with a different album.
      const id = neteaseMetadataId({ ...original, sources: [original, ...(original.sources || []).filter(source => sameArtworkRelease(song, source))] });
      const identity = `${original.provider || ''}:${original.sourceId || original.id || ''}:${key(albumName(song))}:${key(song.artist)}`;
      const tried = new Set();
      let attempts = 0;
      const attempt = async value => {
        const url = artworkUrl(value, size, baseUrl);
        if (!url || tried.has(url) || attempts >= 4 || failures.get(url) > now()) return '';
        scope.signal.throwIfAborted(); tried.add(url); attempts++;
        try {
          await loadImage(url, { signal: scope.signal }); scope.signal.throwIfAborted();
          boundedSet(successes, identity, { url, expires: now() + 86400000 });
          return url;
        } catch (error) {
          if (scope.signal.aborted) throw error;
          boundedSet(failures, url, now() + 30000); return '';
        }
      };
      try {
        const saved = successes.get(identity);
        const candidates = artworkCandidates(song, size, baseUrl);
        if (saved?.expires > now()) candidates.unshift(saved.url);
        // Reserve one attempt for native metadata rather than spending all on broken variants.
        for (const candidate of [...new Set(candidates)].slice(0, id ? 3 : 4)) {
          const url = await attempt(candidate); if (url) return { url, status: 'ready' };
        }
        if (id) {
          let entry = metadata.get(id);
          if (!entry || entry.expires <= now()) {
            try {
              const response = await requestJson(`/api/v1/music/metadata?${new URLSearchParams({ source: 'netease', id, artwork: '1' })}`, { fetchImpl, signal: scope.signal, timeoutMs: 4500 });
              if (response?.code !== 200 || String(response.data?.id) !== id) throw new Error('Mismatched artwork');
              entry = { url: response.data.cover || response.data.albumEntity?.cover || '', expires: now() + 300000 };
              boundedSet(metadata, id, entry);
            } catch (error) {
              if (scope.signal.aborted) throw error;
              // Transient failures are retried sooner than an authoritative miss.
              boundedSet(metadata, id, { url: '', expires: now() + (error.status === 404 ? 300000 : 30000) });
            }
          }
          const url = await attempt(entry?.url); if (url) return { url, status: 'ready' };
        }
        return fallback;
      } catch (error) {
        if (signal?.aborted) throw error;
        return fallback;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}

// Lightweight list/card rendering: native lazy loading, no metadata fan-out per row.
export function bindArtwork(image, song, { size = 320, url = song?.cover, baseUrl = base() } = {}) {
  const fallback = fallbackArtwork(song);
  const src = artworkUrl(url, size, baseUrl);
  image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
  image.classList.add('cplayer-artwork');
  image.style.backgroundImage = `url("${fallback.url}")`;
  image.dataset.artworkState = src ? 'loading' : 'fallback';
  image.onload = () => { if (image.dataset.artworkState !== 'fallback') image.dataset.artworkState = 'ready'; };
  image.onerror = () => {
    image.onerror = null; image.dataset.artworkState = 'fallback'; image.src = fallback.url;
  };
  image.src = src || fallback.url;
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
