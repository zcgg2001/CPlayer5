import { MUSIC_CHANNELS, channelSourceId } from '../music-channels.js';
import { decodeOnlineLyrics } from './encoded.js';
import { parseLyricsPayload } from './document.js';
import { hasLyrics } from './sources.js';

// A channel ID is not automatically a platform ID. Decode only known wrappers.
export function nativeLyricIdentity(song) {
  const provider = MUSIC_CHANNELS[song?.provider]?.platform || song?.provider;
  if (!['qq', 'kugou'].includes(provider)) return null;
  try {
    let id = channelSourceId(song.provider, song.sourceId || song.id);
    if (song.provider.startsWith('jianbin-')) {
      const url = new URL(id);
      if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'www.jbsou.cn' || url.port
          || url.username || url.password || url.pathname !== '/api.php'
          || url.searchParams.get('type') !== (provider === 'qq' ? 'qq' : 'kg') || url.searchParams.getAll('id').length !== 1) return null;
      id = url.searchParams.get('id');
    }
    if (provider === 'qq') {
      if (/^[A-Za-z0-9]{14}$/.test(id) || /^[1-9]\d{0,11}$/.test(id)) return { provider, id };
    } else if (/^[a-f0-9]{32}$/i.test(id)) return { provider, id: id.toLowerCase() };
  } catch { /* Malformed imported IDs are not sent to the native route. */ }
  return null;
}

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
