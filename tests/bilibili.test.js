import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilibiliClient, handleBilibiliRequest, parseBilibiliId, safeBilibiliAudioUrl, safeBilibiliSubtitleUrl, subtitleBodyToLrc, bilibiliDownloadDisposition } from '../sites/bilibili.js';
import worker from '../sites/worker.js';

const bvid = 'BV1C9b76cEks';
const video = {
  bvid, title: '<em class="keyword">Music</em> &amp; Live', pic: '//i0.hdslb.com/test.jpg',
  owner: { name: 'Creator' }, rights: {},
  pages: [{ cid: 123, part: 'First' }, { cid: 456, part: 'Second' }],
};
const audio = [
  { id: 30216, bandwidth: 64000, mimeType: 'audio/mp4', codecs: 'mp4a.40.2', baseUrl: 'https://a.bilivideo.com/low.m4s' },
  { id: 30280, bandwidth: 192000, mimeType: 'audio/mp4', codecs: 'mp4a.40.2', baseUrl: 'https://b.bilivideo.cn/high.m4s' },
];

function mockProvider({ info = video, tracks = audio, preview = false, mediaStatus = 206 } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    requests.push({ target, options });
    if (target.hostname !== 'api.bilibili.com') {
      return new Response(options.method === 'HEAD' ? null : new Uint8Array([1, 2, 3, 4]), {
        status: mediaStatus,
        headers: { 'content-range': 'bytes 0-3/100', 'content-length': '4' },
      });
    }
    let data;
    if (target.pathname.endsWith('/view')) data = info;
    else if (target.pathname.endsWith('/playurl')) data = { dash: { audio: tracks }, is_preview: preview };
    else if (target.pathname.endsWith('/ranking/v2')) data = { list: [video, video] };
    else data = { result: [video] };
    return Response.json({ code: 0, data });
  };
  return { requests, fetchImpl, env: { BILIBILI_FETCH: fetchImpl } };
}

test('parses BV identifiers, namespaced queue keys and multipart video links', () => {
  assert.deepEqual(parseBilibiliId(bvid), { bvid, page: 1 });
  assert.deepEqual(parseBilibiliId(`bili:${bvid}:2`), { bvid, page: 2 });
  assert.deepEqual(parseBilibiliId(`https://www.bilibili.com/video/${bvid}/?p=2`), { bvid, page: 2 });
  for (const input of [
    `https://bilibili.com.evil.test/video/${bvid}`, `https://user@www.bilibili.com/video/${bvid}`,
    `https://www.bilibili.com:8443/video/${bvid}`, `https://127.0.0.1/video/${bvid}`,
    `bili:${bvid}:0`, `bili:${bvid}:10000`, `https://www.bilibili.com/video/${bvid}?p=-1`,
  ]) assert.equal(parseBilibiliId(input), null, input);
});

test('audio URLs only allow HTTPS Bilibili CDN hosts', () => {
  assert.equal(safeBilibiliAudioUrl('http://a.bilivideo.com/file'), 'https://a.bilivideo.com/file');
  for (const url of [
    'https://bilivideo.com.evil.test/a', 'https://evil.test/a', 'https://127.0.0.1/a',
    'https://user:pass@a.bilivideo.com/a', 'https://a.bilivideo.com:8443/a', 'file:///etc/passwd',
  ]) assert.equal(safeBilibiliAudioUrl(url), '');
});

test('discovery normalizes real video metadata and deduplicates ranking entries', async () => {
  const { fetchImpl, requests } = mockProvider();
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  const list = await client.discover('all');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Music & Live');
  assert.equal(list[0].id, `bili:${bvid}:1`);
  assert.equal(list[0].cover, 'https://i0.hdslb.com/test.jpg');
  assert.equal(requests[0].target.searchParams.get('rid'), '1003');
  await client.discover('cover');
  assert.equal(requests[1].target.searchParams.get('keyword'), '翻唱');
  await assert.rejects(client.discover('unsupported'), /分类/);
});

test('keyword search and direct multipart links use separate API paths', async () => {
  const { fetchImpl, requests } = mockProvider();
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  await client.search('music');
  const direct = await client.search(`https://www.bilibili.com/video/${bvid}/?p=2`);
  assert.equal(requests[0].target.pathname, '/x/web-interface/search/type');
  assert.equal(requests[1].target.pathname, '/x/web-interface/view');
  assert.equal(direct[0].id, `bili:${bvid}:2`);
  assert.match(direct[0].name, /Second/);
  await assert.rejects(client.search('https://127.0.0.1'), /无效/);
  await assert.rejects(client.search('x'.repeat(121)), /120/);
  assert.equal(requests.length, 2);
});

test('selects the highest available AAC track and returns an ID-based local stream URL', async () => {
  const { fetchImpl, requests } = mockProvider();
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  const { source, mediaUrl } = await client.resolve(`bili:${bvid}:2`);
  assert.equal(mediaUrl, audio[1].baseUrl);
  assert.equal(source.br, 192000);
  assert.equal(source.format, 'AAC');
  assert.equal(source.cid, 456);
  assert.match(source.url, /^\/api\/v1\/bilibili\/audio\?id=/);
  assert.doesNotMatch(source.url, /bilivideo/);
  assert.equal(requests[1].target.searchParams.get('cid'), '456');
  assert.ok(requests.every(({ options }) => !options.headers.cookie && options.redirect === 'manual'));
});

test('does not invent or downgrade restrictions for paid and no-background videos', async () => {
  for (const rights of [{ pay: 1 }, { ugc_pay: 1 }, { no_background: 1 }, { arc_pay: 1 }]) {
    const { fetchImpl, requests } = mockProvider({ info: { ...video, rights } });
    const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
    await assert.rejects(client.resolve(bvid), error => error.status === 403);
    assert.equal(requests.length, 1);
  }
});

test('uses only validated standard-port backups when the primary CDN has a custom port', async () => {
  const { fetchImpl } = mockProvider({ tracks: [{ ...audio[1],
    baseUrl: 'https://a.mcdn.bilivideo.cn:8082/audio',
    backupUrl: ['https://untrusted.example/audio', 'https://mirror.bilivideo.com/audio'],
  }] });
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  assert.equal((await client.resolve(bvid)).mediaUrl, 'https://mirror.bilivideo.com/audio');
});

test('rejects preview-only playback and untrusted media addresses', async () => {
  for (const options of [{ preview: true }, { tracks: [] }, { tracks: [{ ...audio[0], baseUrl: 'https://evil.test/audio' }] }]) {
    const { fetchImpl } = mockProvider(options);
    const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
    await assert.rejects(client.resolve(bvid), error => error.status === 403);
  }
});

test('keeps pending lookups independent, caches completed responses and expires stale entries', async () => {
  let calls = 0;
  let clock = 100;
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const client = createBilibiliClient({
    now: () => clock, intervalMs: 0,
    fetchImpl: async () => { calls += 1; await pending; return Response.json({ code: 0, data: { result: [video] } }); },
  });
  const first = client.search('music');
  const second = client.search('music');
  complete();
  await Promise.all([first, second]);
  await client.search('music');
  assert.equal(calls, 2);
  clock += 61_000;
  await client.search('music');
  assert.equal(calls, 3);
});

test('backs off after upstream rate limiting rather than retrying repeatedly', async () => {
  let calls = 0;
  let clock = 100;
  const client = createBilibiliClient({
    now: () => clock, intervalMs: 0,
    fetchImpl: async () => { calls += 1; return Response.json({ code: -412 }); },
  });
  await assert.rejects(client.search('music'), error => error.status === 429);
  await assert.rejects(client.search('other'), error => error.status === 429);
  assert.equal(calls, 1);
  clock += 31_000;
  await assert.rejects(client.search('other'), error => error.status === 429);
  assert.equal(calls, 2);
});

test('streams audio ranges and does not forward client cookies or keys upstream', async () => {
  const { env, requests } = mockProvider();
  const response = await worker.fetch(new Request(`http://player.example/api/v1/bilibili/audio?id=${bvid}`, {
    headers: { range: 'bytes=0-3', cookie: 'secret=user-session', authorization: 'private-key' },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/mp4');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.arrayBuffer()).byteLength, 4);
  assert.equal(requests.at(-1).options.headers.range, 'bytes=0-3');
  assert.equal(requests.at(-1).options.headers.referer, 'https://www.bilibili.com/');
  assert.ok(requests.every(({ options }) => !options.headers.cookie && !options.headers.authorization));
});

test('HEAD requests preserve audio headers without fetching a body', async () => {
  const { env, requests } = mockProvider();
  const response = await handleBilibiliRequest(new Request(`https://player.example/api/v1/bilibili/audio?id=${bvid}`, { method: 'HEAD' }), env);
  assert.equal(response.status, 206);
  assert.equal(await response.text(), '');
  assert.equal(requests.at(-1).options.method, 'HEAD');
});

test('invalid stream IDs and multiranges never trigger upstream requests', async () => {
  const { env, requests } = mockProvider();
  const invalidId = await handleBilibiliRequest(new Request('https://player.example/api/v1/bilibili/audio?id=https://127.0.0.1/'), env);
  assert.equal(invalidId.status, 400);
  const invalidRange = await handleBilibiliRequest(new Request(`https://player.example/api/v1/bilibili/audio?id=${bvid}`, {
    headers: { range: 'bytes=0-2,4-6' },
  }), env);
  assert.equal(invalidRange.status, 416);
  assert.equal(requests.length, 0);
});

test('Bilibili routes work without a NetEase API key and never use the NetEase upstream', async () => {
  const { env } = mockProvider();
  env.MUSIC_FETCH = () => { throw new Error('Wrong provider'); };
  const response = await worker.fetch(new Request('https://player.example/api/v1/music/search?source=bilibili&keyword=music'), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].provider, 'bilibili');
});

test('downloads require an explicit download permission even when playback works', async () => {
  for (const download of [0, undefined, -1, 'unknown']) {
    const { env, requests } = mockProvider({ info: { ...video, rights: { download } } });
    const response = await worker.fetch(new Request(`https://player.example/api/v1/bilibili/download?id=${bvid}`), env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'download_restricted');
    assert.equal(requests.length, 1);
  }
});

test('download endpoint streams an M4A attachment with a safe Unicode filename', async () => {
  const { env } = mockProvider({ info: { ...video, title: '音乐\r\n"/test', rights: { download: 1 } } });
  const response = await worker.fetch(new Request(`https://player.example/api/v1/bilibili/download?id=${bvid}`, { headers: { Range: 'bytes=0-3' } }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/mp4');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  const disposition = response.headers.get('content-disposition');
  assert.match(disposition, /^attachment; filename="BV1C9b76cEks-P1.m4a";/);
  assert.match(disposition, /filename\*=UTF-8''/);
  assert.doesNotMatch(disposition, /[\r\n]/);
  assert.equal((await response.arrayBuffer()).byteLength, 4);
  assert.doesNotThrow(() => bilibiliDownloadDisposition('broken\uD800', bvid));
});

test('subtitle URLs only allow known subtitle paths on the image CDN', () => {
  assert.equal(safeBilibiliSubtitleUrl('//aisubtitle.hdslb.com/bfs/subtitle/abc.json?auth_key=public'),
    'https://aisubtitle.hdslb.com/bfs/subtitle/abc.json?auth_key=public');
  for (const url of [
    'https://127.0.0.1/bfs/subtitle/a.json', 'https://aisubtitle.hdslb.com.evil.test/bfs/subtitle/a.json',
    'https://aisubtitle.hdslb.com:8443/bfs/subtitle/a.json', 'https://user@aisubtitle.hdslb.com/bfs/subtitle/a.json',
    'https://aisubtitle.hdslb.com/bfs/archive/a.json', 'file:///bfs/subtitle/a.json',
  ]) assert.equal(safeBilibiliSubtitleUrl(url), '');
});

test('subtitle conversion sorts valid timestamps and normalizes multiline text', () => {
  const lrc = subtitleBodyToLrc({ body: [
    { from: 65.125, to: 70, content: 'Later\nline' },
    { from: 1.2, to: 2, content: '<b>Literal</b>' },
    { from: -1, to: 2, content: 'Invalid' },
    { from: null, to: 2, content: 'Invalid' },
    { from: 5, to: 4, content: 'Invalid' },
    { from: 2, to: 3, content: '' },
  ] });
  assert.equal(lrc, '[00:01.200]<b>Literal</b>\n[01:05.125]Later line');
  assert.throws(() => subtitleBodyToLrc({}), /格式/);
  assert.throws(() => subtitleBodyToLrc({ body: Array(10001).fill({}) }), /过大/);
});

function subtitleProvider({ player = {}, body = { body: [] }, subtitleResponse } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    requests.push({ target, options });
    if (target.pathname.endsWith('/view')) return Response.json({ code: 0, data: video });
    if (target.pathname.endsWith('/v2')) return Response.json({ code: 0, data: player });
    return subtitleResponse ? subtitleResponse() : Response.json(body);
  };
  return { requests, fetchImpl };
}

test('anonymous lyric responses distinguish absent, login-required and restricted subtitles', async () => {
  for (const [player, status] of [
    [{ subtitle: { subtitles: [] } }, 'unavailable'],
    [{ need_login_subtitle: true, subtitle: { subtitles: [] } }, 'login_required'],
    [{ is_upower_exclusive: true }, 'restricted'],
  ]) {
    const { requests, fetchImpl } = subtitleProvider({ player });
    const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
    const result = await client.lyrics(bvid);
    assert.equal(result.status, status);
    assert.equal(result.lrc, '');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].target.searchParams.get('cid'), '123');
  }
});

test('selects human Chinese subtitles before AI and other languages, then caches text', async () => {
  const subtitles = [
    { id_str: '1', lan: 'en', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/en.json' },
    { id_str: '2', lan: 'zh-CN', ai_status: 1, subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/ai.json' },
    { id_str: '3', lan: 'zh-Hans', lan_doc: '简体中文', ai_status: 0, subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/zh.json' },
  ];
  const { requests, fetchImpl } = subtitleProvider({ player: { subtitle: { subtitles } }, body: { body: [{ from: 0, to: 2, content: '字幕' }] } });
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  const result = await client.lyrics(`bili:${bvid}:2`);
  assert.equal(result.status, 'available');
  assert.equal(result.language, '简体中文');
  assert.equal(result.autoGenerated, false);
  assert.equal(result.lrc, '[00:00.000]字幕');
  assert.equal(requests[1].target.searchParams.get('cid'), '456');
  assert.equal(requests[2].target.pathname, '/bfs/subtitle/zh.json');
  await client.lyrics(`bili:${bvid}:2`);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ options }) => !options.headers.cookie && options.redirect === 'manual'));
});

test('never fetches subtitle resources when the upstream requires login', async () => {
  const { requests, fetchImpl } = subtitleProvider({ player: { need_login_subtitle: true, subtitle: { subtitles: [
    { lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/a.json' },
  ] } } });
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  assert.equal((await client.lyrics(bvid)).status, 'login_required');
  assert.equal(requests.length, 2);
});

test('rejects oversized subtitle files before loading and does not expose signed URLs', async () => {
  const { fetchImpl } = subtitleProvider({ player: { subtitle: { subtitles: [
    { lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/a.json?auth_key=token' },
  ] } }, subtitleResponse: () => new Response('data', { headers: { 'content-length': String(3 * 1024 * 1024) } }) });
  const response = await worker.fetch(new Request(`https://player.example/api/v1/music/lyric?source=bilibili&id=${bvid}`), { BILIBILI_FETCH: fetchImpl });
  assert.equal(response.status, 502);
  const payload = await response.text();
  assert.match(payload, /subtitle_too_large/);
  assert.doesNotMatch(payload, /auth_key|token/);
});

test('cancels subtitle file requests with the caller signal', async () => {
  const controller = new AbortController();
  const { fetchImpl } = subtitleProvider({ player: { subtitle: { subtitles: [
    { lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/a.json' },
  ] } } });
  let subtitleSignal;
  const client = createBilibiliClient({ intervalMs: 0, fetchImpl: async (url, options) => {
    if (!url.includes('/bfs/subtitle/')) return fetchImpl(url, options);
    subtitleSignal = options.signal;
    controller.abort();
    throw options.signal.reason;
  } });
  await assert.rejects(client.lyrics(bvid, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(subtitleSignal.aborted, true);
});

test('enforces subtitle size limits on chunked responses without content-length', async () => {
  let cancelled = false;
  const { fetchImpl } = subtitleProvider({ player: { subtitle: { subtitles: [
    { lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/a.json' },
  ] } }, subtitleResponse: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })) });
  const client = createBilibiliClient({ fetchImpl, intervalMs: 0 });
  await assert.rejects(client.lyrics(bvid), error => error.code === 'subtitle_too_large');
  assert.equal(cancelled, true);
});
