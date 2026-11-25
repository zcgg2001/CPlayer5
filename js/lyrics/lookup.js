import { parseLyricsPayload } from './document.js';
import { hasLyrics, lyricQuality } from './sources.js';
import { versionOf } from '../music-catalog.js';

const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·•]+/g, '').trim();
const known = value => value && !/^(unknown|未知.*)$/i.test(value);
const artists = value => String(value || '').split(/\s*(?:\/|、|,|，|;|；| & | feat\. | ft\. )\s*/i).map(normalized).filter(known);
const albumName = song => typeof song?.album === 'string' ? song.album : song?.album?.name || song?.albumEntity?.name || '';

// Keep live/remix qualifiers and duration: the first search hit may be another recording.
export function matchesLyricRecording(song, result) {
  if (!known(song?.name) || !known(song?.artist) || !result?.trackName || !result?.artistName) return false;
  if (normalized(song.name) !== normalized(result.trackName)) return false;
  if (versionOf(song.name, song.versionLabel).kind !== versionOf(result.trackName).kind) return false;
  const wanted = artists(song.artist), found = artists(result.artistName);
  if (!wanted.length || !found.length || !wanted.every(name => found.includes(name)) || !found.every(name => wanted.includes(name))) return false;
  const duration = Number(song.duration || song.metadata?.duration), candidateDuration = Number(result.duration);
  if (duration > 0 && candidateDuration > 0) return Math.abs(duration - candidateDuration) <= 3;
  return Boolean(known(albumName(song)) && normalized(albumName(song)) === normalized(result.albumName));
}

export function lyricSearchCandidates(song, results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  return results.slice(0, 100).filter(row => row && !row.instrumental && matchesLyricRecording(song, row)).flatMap(row => {
    const synced = typeof row.syncedLyrics === 'string' ? row.syncedLyrics : '';
    const plain = typeof row.plainLyrics === 'string' ? row.plainLyrics : '';
    if (synced.length + plain.length > 150_000) return [];
    let document = parseLyricsPayload({ lrc: synced || plain, source: 'LRCLIB' });
    if (!hasLyrics(document) && plain) document = parseLyricsPayload({ lrc: plain, source: 'LRCLIB' });
    if (!hasLyrics(document)) return [];
    const identity = JSON.stringify([document.lines.map(line => [line.start, line.text]), document.plain]);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ document, album: row.albumName || '', duration: row.duration, id: row.id }];
  }).sort((a, b) => lyricQuality(b.document) - lyricQuality(a.document)
    || Number(normalized(b.album) === normalized(albumName(song))) - Number(normalized(a.album) === normalized(albumName(song)))
    || Math.abs(Number(a.duration) - Number(song.duration || 0)) - Math.abs(Number(b.duration) - Number(song.duration || 0))).slice(0, 5);
}

async function readBoundedJson(response) {
  if (!response.ok) throw Object.assign(new Error(response.status === 429 ? '歌词补全请求较多，请稍后重试' : '歌词补全服务暂时不可用'), { status: response.status });
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error('歌词结果过大，请稍后重试');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(await new Blob(chunks).text());
}

// LRCLIB supports public CORS. APKs can use this without a server upgrade or API key.
export async function lookupLyrics(song, { signal, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  signal?.throwIfAborted();
  if (!known(song?.name) || !known(song?.artist)) return [];
  const request = new AbortController();
  const abort = () => request.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => request.abort(), timeoutMs);
  try {
    let lastError;
    const structured = new URLSearchParams({ track_name: song.name, artist_name: song.artist });
    if (albumName(song)) structured.set('album_name', albumName(song));
    for (const params of [structured, new URLSearchParams({ q: `${song.name} ${song.artist}` })]) {
      try {
        const response = await fetchImpl(`https://lrclib.net/api/search?${params}`, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        const matches = lyricSearchCandidates(song, await readBoundedJson(response));
        request.signal.throwIfAborted();
        if (matches.length) return matches;
      } catch (error) {
        request.signal.throwIfAborted();
        if (error.status === 429) throw error;
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return [];
  } catch (error) {
    signal?.throwIfAborted();
    if (request.signal.aborted) throw new Error('歌词补全超时，可稍后重试或导入歌词');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
