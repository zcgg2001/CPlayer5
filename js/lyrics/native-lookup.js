import { decodeOnlineLyrics } from './encoded.js';
import { parseLyricsPayload } from './document.js';
import { hasLyrics } from './sources.js';
import { lyricPlatformIdentity as nativeLyricIdentity } from './providers.js';
export { lyricPlatformIdentity as nativeLyricIdentity } from './providers.js';

export function createNativeLyricLookup({ fetchImpl = globalThis.fetch, timeoutMs = 10_000, now = Date.now } = {}) {
  const cache = new Map();
  return async function lookup(song, { signal, refresh = false } = {}) {
    signal?.throwIfAborted();
    const identity = nativeLyricIdentity(song);
    if (!identity) return [];
    const key = `${identity.provider}:${identity.id}`, cached = cache.get(key);
    if (!refresh && cached && now() - cached.time < (cached.result.length ? 300_000 : 30_000)) return cached.result;
    const request = new AbortController(), abort = () => request.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => request.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`/android-player/online-lyrics?${new URLSearchParams(identity)}`, {
        signal: request.signal, credentials: 'omit', cache: 'no-store',
      });
      if (!response.ok) throw new Error('在线逐字歌词暂不可用');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 512 * 1024) throw new Error('在线歌词结果过大');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(await new Blob(chunks).text());
      if (data.provider !== identity.provider || data.id !== identity.id) throw new Error('歌词歌曲标识不匹配');
      const payload = await decodeOnlineLyrics(data);
      request.signal.throwIfAborted();
      const document = parseLyricsPayload(payload, Number(song.duration || song.metadata?.duration) * 1000 || Infinity);
      const result = hasLyrics(document) ? [{ document }] : [];
      cache.delete(key); cache.set(key, { time: now(), result });
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      cache.set(key, { time: now(), result: [] });
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}
