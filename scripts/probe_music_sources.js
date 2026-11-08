import { writeFile } from 'node:fs/promises';
import { MUSIC_CHANNELS } from '../js/music-channels.js';
import { normalizeSearchPayload, normalizeBilibiliPayload, normalizeSongPayload } from '../js/music-data.js';

const [origin, ...args] = process.argv.slice(2);
if (!origin || !/^https?:\/\//.test(origin)) {
  console.error('Usage: npm run probe:music -- <site-origin> [providers...] [--rounds=1] [--output=report.json]');
  process.exit(2);
}
const base = new URL(origin).origin;
const all = ['gd', 'chksz', ...Object.keys(MUSIC_CHANNELS), 'bilibili'];
const selected = args.filter(arg => !arg.startsWith('--'));
const providers = selected.length ? selected : all;
if (providers.some(name => !all.includes(name))) throw new Error('Unknown music source');
const rounds = Number(args.find(arg => arg.startsWith('--rounds='))?.split('=')[1] || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw new Error('Rounds must be between 1 and 3');
const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
const report = { site: base, checkedAt: new Date().toISOString(), rounds, method: 'Sequential samples per provider; two providers at most in parallel. Search, highest-quality resolution, then first 4 KiB of real audio. Samples may hit caches; not a concurrency or endurance test.', sources: [] };

async function json(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(22000), headers: { accept: 'application/json' } });
  let payload;
  try { payload = await response.json(); } catch { throw Object.assign(new Error('Non-JSON response'), { status: response.status }); }
  if (!response.ok || payload.error) throw Object.assign(new Error(payload.error?.message || `HTTP ${response.status}`), { status: response.status, code: payload.error?.code });
  return payload;
}
async function audioSample(value) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid audio URL');
  const response = await fetch(url, { headers: { range: 'bytes=0-4095' }, signal: AbortSignal.timeout(15000) });
  const type = response.headers.get('content-type') || '';
  if (![200, 206].includes(response.status) || !/audio|octet-stream|video\/mp4/i.test(type)) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Audio HTTP ${response.status}, Content-Type ${type}`), { status: response.status });
  }
  const reader = response.body.getReader();
  let bytes = 0, first;
  try {
    while (bytes < 4096) { const chunk = await reader.read(); if (chunk.done) break; first ??= chunk.value; bytes += chunk.value.byteLength; }
  } finally { await reader.cancel(); }
  if (!bytes || /^\s*[<{]/.test(new TextDecoder().decode(first?.subarray(0, 32)))) throw new Error('Audio returned empty/text content');
  const header = Buffer.from(first);
  const isFlac = header.subarray(0,4).toString() === 'fLaC';
  const info = isFlac && header.length >= 26 ? header.readBigUInt64BE(18) : null;
  return { status: response.status, contentType: type, bytes, signature: header.subarray(0,8).toString('hex'),
    format: isFlac ? 'flac' : header.subarray(0,3).toString() === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224) ? 'mp3' : 'unknown',
    ...(info !== null ? { sampleRate:Number(info >> 44n), bitDepth:Number((info >> 36n) & 31n) + 1 } : {}),
    host: new URL(response.url).host };
}
async function probe(provider) {
  const result = { provider, samples: [] };
  for (let round = 1; round <= rounds; round++) for (const keyword of ['晴天', '青花瓷', '稻香']) {
    const sample = { round, keyword }, start = Date.now(); result.samples.push(sample);
    let stage = 'search';
    try {
      const found = await json(`/api/v1/music/search?${new URLSearchParams({ source: provider, keyword, limit: '3' })}`);
      const songs = provider === 'bilibili' ? normalizeBilibiliPayload(found) : MUSIC_CHANNELS[provider] ? found.data : normalizeSearchPayload(found);
      const song = songs?.find(item => item.id);
      if (!song) throw new Error('No search results');
      sample.name = song.name; sample.id = song.id; sample.searchMs = Date.now() - start;
      stage = 'resolve';
      const level = provider === 'chksz' ? 'jymaster' : provider === 'gd' ? 'hires' : MUSIC_CHANNELS[provider]?.qualities.at(-1) || 'standard';
      const began = Date.now();
      const resolved = await json(`/api/v1/music/song?${new URLSearchParams({ source: provider, id: song.id, level })}`);
      const playback = provider === 'bilibili' ? normalizeBilibiliPayload(resolved)[0] : normalizeSongPayload(resolved, level);
      if (!playback?.url) throw new Error('No audio URL');
      sample.resolveMs = Date.now() - began; sample.requestedLevel = level; sample.resolvedLevel = playback.level;
      stage = 'audio'; const audioStart = Date.now();
      sample.audio = await audioSample(playback.url); sample.audioMs = Date.now() - audioStart;
      sample.status = 'passed';
    } catch (error) {
      sample.status = 'failed'; sample.failedStage = stage;
      sample.error = { status: error.status, code: error.code, message: error.message };
    }
    sample.totalMs = Date.now() - start;
    console.error(`${provider} ${round}/${keyword}: ${sample.status} (${sample.totalMs} ms)`);
    if ([401, 402, 403, 429].includes(sample.error?.status)) { result.stoppedOnRefusal = true; return finish(result); }
  }
  return finish(result);
}
function finish(result) {
  const passed = result.samples.filter(item => item.status === 'passed');
  const times = passed.map(item => item.totalMs).sort((a,b) => a-b);
  return { ...result, passed: passed.length, tested: result.samples.length, medianMs: times.length ? times[Math.floor(times.length / 2)] : null };
}
let cursor = 0;
await Promise.all(Array.from({length:2}, async () => {
  while (cursor < providers.length) { const provider = providers[cursor++]; report.sources.push(await probe(provider)); }
}));
report.sources.sort((a,b) => b.passed/b.tested-a.passed/a.tested || (a.medianMs ?? Infinity)-(b.medianMs ?? Infinity));
report.completedAt = new Date().toISOString();
const serialized = JSON.stringify(report, null, 2) + '\n';
if (output) await writeFile(output, serialized);
console.log(serialized);
