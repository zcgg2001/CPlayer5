import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicService } from '../js/music-service.js';
import { lyricRequestCandidates, lyricPlatformIdentity } from '../js/lyrics/providers.js';
import { createPlaybackController } from '../js/playback-controller.js';
import { createQueueStore } from '../js/queue-store.js';

const song = { id: '186016', sourceId: '186016', provider: 'gd', name: '原创测试', artist: '测试歌手', album: '测试专辑', duration: 180 };
const service = () => new MusicService({ storage: null });
const response = lrc => Response.json({ code: 200, data: { lrc } });

test('empty, placeholder and failed GD lyrics fall back to the same NetEase ID without quota channels', async () => {
  for (const first of [() => response(''), () => response('[00:00]暂无歌词'), () => new Response('', { status: 503 })]) {
    const calls = [];
    const result = await service().getLyric(song.id, { song, fetchImpl: async value => {
      const url = new URL(value, 'https://player.example'); calls.push(url);
      return calls.length === 1 ? first() : response('[00:01]找回正确的歌词');
    } });
    assert.equal(result.lrc, '[00:01]找回正确的歌词');
    assert.deepEqual(calls.map(url => [url.searchParams.get('source'), url.searchParams.get('id')]), [['gd', '186016'], ['netease', '186016']]);
  }
});

test('audio source switching retains the wall recording as a lyric fallback and rejects unrelated versions', () => {
  const switched = { ...song, provider: 'qq', sourceId: '0039MnYb0qxYhV', artworkSource: song,
    sources: [{ ...song, provider: 'op-qq', sourceId: '004Fs2FP1EvZYc', name: '原创测试 (Live)' }] };
  assert.deepEqual(lyricRequestCandidates(switched), [
    { provider: 'gd', id: song.id }, { provider: 'netease', id: song.id }, { provider: 'qq', id: switched.sourceId },
  ]);
  const foreign = 'https://wrong.example/api.php?type=wy&id=186016';
  assert.equal(lyricPlatformIdentity({ provider: 'jianbin-netease', id: foreign }), null);
  assert.equal(lyricPlatformIdentity({ provider: 'qq', id: '186016' }).provider, 'qq');
  assert.equal(lyricPlatformIdentity({ provider: 'gequke', id: '186016' }), null);
  assert.deepEqual(lyricPlatformIdentity({ provider: 'op-netease', id: 'op-netease:186016' }), { provider: 'netease', id: '186016' });
});

test('a stalled lyric channel has a bounded timeout, then tries the next channel', async () => {
  const calls = [];
  const result = await service().getLyric(song.id, { song, timeoutMs: 8, fetchImpl: async (value, { signal }) => {
    const source = new URL(value, 'https://player.example').searchParams.get('source'); calls.push(source);
    if (source === 'gd') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return response('[00:01]备用歌词');
  } });
  assert.equal(result.lrc, '[00:01]备用歌词'); assert.deepEqual(calls, ['gd', 'netease']);
});

test('cancellation and site-wide throttling stop further lyric requests', async () => {
  let calls = 0;
  const ctrl = new AbortController();
  await assert.rejects(service().getLyric(song.id, { song, signal: ctrl.signal, fetchImpl: async () => {
    calls++; ctrl.abort(); return response('[00:01]已过期歌词');
  } }), { name: 'AbortError' });
  assert.equal(calls, 1); calls = 0;
  assert.equal(await service().getLyric(song.id, { song, fetchImpl: async () => {
    calls++; return Response.json({ error: { code: 'site_rate_limited' } }, { status: 429 });
  } }), null);
  assert.equal(calls, 1);
});

test('plain lyrics stay available when a secondary timeline cannot be fetched', async () => {
  const result = await service().getLyric(song.id, { song, fetchImpl: async value =>
    new URL(value, 'https://player.example').searchParams.get('source') === 'gd' ? response('只有纯文本的歌词') : response('') });
  assert.equal(result.lrc, '只有纯文本的歌词');
});

test('lyric requests start before audio readiness and a new selection cancels obsolete lyrics', async () => {
  let releaseAudio, firstSignal;
  const audioReady = new Promise(resolve => releaseAudio = resolve), delivered = [], requested = [];
  const audio = { pause() {}, src: '', play: () => audioReady, addEventListener() {}, removeEventListener() {}, load() {}, removeAttribute() {} };
  const controller = createPlaybackController({ audio, queueStore: createQueueStore(), musicService: {
    getSong: async id => ({ ...song, id, sourceId: id, url: `https://audio.example.org/${id}.mp3` }),
    async getLyric(id, { signal }) {
      requested.push(id); if (id === '186016') firstSignal = signal;
      return { lrc: id };
    },
  } });
  try {
    const first = controller.load(song.id, song, { onLyrics: data => delivered.push(data.lrc) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(requested, [song.id]); assert.deepEqual(delivered, [song.id]);
    const next = controller.load('186017', { ...song, id: '186017', sourceId: '186017' });
    assert.equal(firstSignal.aborted, true);
    releaseAudio(); await Promise.all([first, next]);
  } finally { releaseAudio(); controller.stop(); }
});
