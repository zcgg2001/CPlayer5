import { normalizeSearchPayload, normalizeBilibiliPayload, normalizeSongPayload, normalizeLyricsPayload } from '../js/music-data.js';

const [origin, ...selected] = process.argv.slice(2);
if (!origin || !/^https?:\/\//.test(origin)) {
  console.error('Usage: npm run probe:music -- <site-origin> [chksz gd bilibili]');
  process.exit(2);
}
const base = new URL(origin).origin;
const providers = selected.length ? selected : ['chksz', 'gd', 'bilibili'];
if (providers.some(name => !['chksz', 'gd', 'bilibili'].includes(name))) throw new Error('Unknown music source');
const report = { site: base, checkedAt: new Date().toISOString(), sources: [] };

async function json(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(45000), headers: { accept: 'application/json' } });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    await response.body?.cancel();
    const error = new Error(`Site returned HTTP ${response.status} without JSON; check site access before testing providers`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

async function audioSample(value) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid audio URL');
  const response = await fetch(url, {
    headers: { range: 'bytes=0-4095' }, signal: AbortSignal.timeout(20000),
  });
  const type = response.headers.get('content-type') || '';
  if (![200, 206].includes(response.status) || !/audio|octet-stream|video\/mp4/i.test(type)) {
    await response.body?.cancel();
    throw new Error(`Audio HTTP ${response.status}, Content-Type ${type}`);
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let first;
  try {
    while (bytes < 4096) {
      const chunk = await reader.read();
      if (chunk.done) break;
      first ??= chunk.value;
      bytes += chunk.value.byteLength;
    }
  } finally { await reader.cancel(); }
  if (!bytes || /^\s*[<{]/.test(new TextDecoder().decode(first?.subarray(0, 32)))) throw new Error('Audio returned empty/text content');
  return { status: response.status, contentType: type, bytes, host: new URL(response.url).host };
}

for (const provider of providers) {
  const result = { provider, checks: {} };
  report.sources.push(result);
  let stage = 'configuration';
  try {
    if (provider === 'chksz') {
      const settings = await json('/api/v1/settings/music-key');
      if (!settings.configured) throw new Error('CHKSZ_API_KEY is not configured');
    }
    stage = 'search';
    const keyword = provider === 'bilibili' ? '吉他弹唱' : '晴天';
    const found = await json(`/api/v1/music/search?${new URLSearchParams({ source: provider, keyword, limit: '3' })}`);
    const songs = provider === 'bilibili' ? normalizeBilibiliPayload(found) : normalizeSearchPayload(found);
    if (!songs.length) throw new Error('Search returned no usable tracks');
    const song = songs[0];
    result.checks.search = { count: songs.length, id: song.id, name: song.name };
    stage = 'resolve';
    const query = new URLSearchParams({ source: provider, id: song.id, level: 'standard' });
    const resolved = await json(`/api/v1/music/song?${query}`);
    const playback = provider === 'bilibili' ? normalizeBilibiliPayload(resolved)[0] : normalizeSongPayload(resolved, 'standard');
    if (!playback?.url) throw new Error('No playable audio URL');
    result.checks.resolve = { quality: playback.level, bitrate: playback.br };
    stage = 'audio';
    result.checks.audio = await audioSample(playback.url);
    stage = 'lyrics';
    const lyrics = await json(`/api/v1/music/lyric?${query}`);
    const normalized = provider === 'bilibili' ? lyrics.data : normalizeLyricsPayload(lyrics);
    if (!normalized) throw new Error('Invalid lyric response');
    result.checks.lyrics = { status: normalized.status || (normalized.lrc ? 'available' : 'unavailable'), characters: normalized.lrc?.length || 0 };
    result.status = 'passed';
  } catch (error) {
    result.status = 'blocked';
    result.failedStage = stage;
    result.error = { status: error.status, code: error.code, message: error.message };
    // Never retry upstream refusals or silently switch providers.
    process.exitCode = 1;
  }
  console.error(`${provider}: ${result.status}${result.failedStage ? ` (${result.failedStage})` : ''}`);
}
console.log(JSON.stringify(report, null, 2));
